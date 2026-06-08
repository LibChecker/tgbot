const EOCD_SIGNATURE = 0x06054b50;
const utf8Decoder = new TextDecoder();

const APK_SIG_BLOCK_MIN_SIZE = 32;
const APK_SIG_BLOCK_FOOTER_SIZE = 24;
const APK_SIGNATURE_SCHEME_BLOCK_IDS = new Map([
  [0x7109871a, "V2"],
  [0xf05368c0, "V3"],
  [0x1b93ad61, "V3.1"],
]);
const APK_SIG_BLOCK_MAGIC = new Uint8Array([
  0x41, 0x50, 0x4b, 0x20, 0x53, 0x69, 0x67, 0x20,
  0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x20, 0x34, 0x32,
]);
const V1_SIGNATURE_ENTRY_PATTERN = /^META-INF\/[^/]+\.(?:RSA|DSA|EC)$/iu;
const DEFAULT_MAX_SIGNATURE_ENTRY_BYTES = 2 * 1024 * 1024;

const DIGEST_HEX_SEPARATOR = ":";
const X509_ALGORITHM_NAMES = new Map([
  ["1.2.840.113549.1.1.1", "RSA"],
  ["1.2.840.10040.4.1", "DSA"],
  ["1.2.840.10045.2.1", "EC"],
  ["1.2.840.113549.1.1.5", "SHA1withRSA"],
  ["1.2.840.113549.1.1.11", "SHA256withRSA"],
  ["1.2.840.113549.1.1.12", "SHA384withRSA"],
  ["1.2.840.113549.1.1.13", "SHA512withRSA"],
  ["1.2.840.10040.4.3", "SHA1withDSA"],
  ["2.16.840.1.101.3.4.3.2", "SHA256withDSA"],
  ["1.2.840.10045.4.1", "SHA1withECDSA"],
  ["1.2.840.10045.4.3.2", "SHA256withECDSA"],
  ["1.2.840.10045.4.3.3", "SHA384withECDSA"],
  ["1.2.840.10045.4.3.4", "SHA512withECDSA"],
]);
const X509_NAME_ATTRIBUTE_LABELS = new Map([
  ["2.5.4.3", "CN"],
  ["2.5.4.4", "SN"],
  ["2.5.4.5", "SERIALNUMBER"],
  ["2.5.4.6", "C"],
  ["2.5.4.7", "L"],
  ["2.5.4.8", "ST"],
  ["2.5.4.9", "STREET"],
  ["2.5.4.10", "O"],
  ["2.5.4.11", "OU"],
  ["2.5.4.12", "T"],
  ["2.5.4.42", "GN"],
  ["1.2.840.113549.1.9.1", "EMAILADDRESS"],
  ["0.9.2342.19200300.100.1.1", "UID"],
  ["0.9.2342.19200300.100.1.25", "DC"],
]);
const MD5_SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
);

export async function readApkSignatures(source, options = {}) {
  const schemes = new Set();
  const certificateRecords = [];
  const warnings = [];
  const maxSignatureEntryBytes = options.maxSignatureEntryBytes ?? DEFAULT_MAX_SIGNATURE_ENTRY_BYTES;

  for (const [path, entry] of source.zipEntries.entries()) {
    if (!V1_SIGNATURE_ENTRY_PATTERN.test(path)) {
      continue;
    }

    schemes.add("V1");

    if (entryExceedsSizeLimit(entry, maxSignatureEntryBytes)) {
      warnings.push(`Skipped oversized signature entry: ${path}`);
      continue;
    }

    try {
      const signatureBytes = await extractSourceEntry(source, entry);
      const certificates = collectX509CertificatesFromDer(signatureBytes);
      for (const certificateBytes of certificates) {
        certificateRecords.push({
          scheme: "V1",
          sourceEntry: path,
          bytes: certificateBytes,
        });
      }
    } catch (error) {
      warnings.push(`Failed to parse signature entry ${path}: ${getErrorText(error)}`);
    }
  }

  if (source.apkBytes) {
    for (const block of parseApkSigningSchemeBlocks(source.apkBytes)) {
      schemes.add(block.scheme);

      try {
        for (const certificateBytes of extractCertificatesFromApkSigningSchemeBlock(block.value)) {
          certificateRecords.push({
            scheme: block.scheme,
            sourceEntry: "",
            bytes: certificateBytes,
          });
        }
      } catch (error) {
        warnings.push(`Failed to parse ${block.scheme} signing block: ${getErrorText(error)}`);
      }
    }
  }

  const certificates = await buildSignatureCertificateList(certificateRecords, warnings);
  return {
    schemes: sortSignatureSchemes([...schemes]),
    certificates,
    ...(warnings.length ? { warnings } : {}),
  };
}

async function buildSignatureCertificateList(records, warnings) {
  const grouped = new Map();

  for (const record of records) {
    const key = bytesToHex(record.bytes, "");
    let group = grouped.get(key);
    if (!group) {
      group = {
        bytes: record.bytes,
        schemes: new Set(),
        sourceEntries: new Set(),
      };
      grouped.set(key, group);
    }

    group.schemes.add(record.scheme);
    if (record.sourceEntry) {
      group.sourceEntries.add(record.sourceEntry);
    }
  }

  const certificates = [];
  for (const group of grouped.values()) {
    try {
      const fields = parseX509CertificateFields(group.bytes);
      certificates.push({
        ...fields,
        schemes: sortSignatureSchemes([...group.schemes]),
        sourceEntries: [...group.sourceEntries].sort((left, right) => left.localeCompare(right)),
        derLength: group.bytes.byteLength,
        fingerprints: await computeCertificateFingerprints(group.bytes),
        charString: bytesToHex(group.bytes, "", { upper: false }),
      });
    } catch (error) {
      warnings.push(`Failed to parse X.509 certificate: ${getErrorText(error)}`);
    }
  }

  certificates.sort((left, right) => {
    const schemeOrder = compareSignatureSchemeNames(left.schemes[0], right.schemes[0]);
    if (schemeOrder !== 0) {
      return schemeOrder;
    }

    return String(left.serialNumber?.hex || "").localeCompare(String(right.serialNumber?.hex || ""));
  });

  return certificates;
}

function parseApkSigningSchemeBlocks(apkBytes) {
  try {
    const eocdOffset = findEndOfCentralDirectory(apkBytes);
    const centralDirectoryOffset = readUint32(apkBytes, eocdOffset + 16);
    if (centralDirectoryOffset < APK_SIG_BLOCK_MIN_SIZE) {
      return [];
    }

    const footerOffset = centralDirectoryOffset - APK_SIG_BLOCK_FOOTER_SIZE;
    if (footerOffset < 0 || !matchesBytes(apkBytes, footerOffset + 8, APK_SIG_BLOCK_MAGIC)) {
      return [];
    }

    const blockSizeInFooter = readUint64(apkBytes, footerOffset);
    const totalBlockSize = blockSizeInFooter + 8;
    const blockOffset = centralDirectoryOffset - totalBlockSize;
    if (blockOffset < 0) {
      return [];
    }

    const blockSizeInHeader = readUint64(apkBytes, blockOffset);
    if (blockSizeInHeader !== blockSizeInFooter) {
      return [];
    }

    const blocks = [];
    const pairsEnd = footerOffset;
    let offset = blockOffset + 8;
    while (offset + 8 <= pairsEnd) {
      const pairSize = readUint64(apkBytes, offset);
      const pairStart = offset + 8;
      const pairEnd = pairStart + pairSize;
      if (pairSize < 4 || pairEnd > pairsEnd) {
        break;
      }

      const id = readUint32(apkBytes, pairStart);
      const scheme = APK_SIGNATURE_SCHEME_BLOCK_IDS.get(id);
      if (scheme) {
        blocks.push({
          scheme,
          value: apkBytes.subarray(pairStart + 4, pairEnd),
        });
      }

      offset = pairEnd;
    }

    return blocks;
  } catch {
    return [];
  }
}

function extractCertificatesFromApkSigningSchemeBlock(blockValue) {
  const certificates = [];
  const signers = readApkSigningSchemeSigners(blockValue);
  let offset = 0;

  while (offset < signers.byteLength) {
    const signer = readLengthPrefixedSlice(signers, offset, signers.byteLength);
    offset = signer.nextOffset;
    certificates.push(...extractCertificatesFromApkSigner(signer.bytes));
  }

  return certificates;
}

function readApkSigningSchemeSigners(blockValue) {
  const sequence = readLengthPrefixedSlice(blockValue, 0, blockValue.byteLength);
  if (sequence.nextOffset === blockValue.byteLength) {
    return sequence.bytes;
  }

  return blockValue;
}

function extractCertificatesFromApkSigner(signerBytes) {
  const signedData = readLengthPrefixedSlice(signerBytes, 0, signerBytes.byteLength);
  let signedDataOffset = 0;
  const digests = readLengthPrefixedSlice(signedData.bytes, signedDataOffset, signedData.bytes.byteLength);
  signedDataOffset = digests.nextOffset;
  const certificates = readLengthPrefixedSlice(signedData.bytes, signedDataOffset, signedData.bytes.byteLength);
  return readLengthPrefixedByteArrays(certificates.bytes);
}

function readLengthPrefixedByteArrays(bytes) {
  const items = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    const item = readLengthPrefixedSlice(bytes, offset, bytes.byteLength);
    items.push(item.bytes);
    offset = item.nextOffset;
  }

  return items;
}

function readLengthPrefixedSlice(bytes, offset, limit) {
  if (offset + 4 > limit) {
    throw new Error("Length-prefixed value exceeds its container");
  }

  ensureReadable(bytes, offset, 4);
  const length = readUint32(bytes, offset);
  const valueStart = offset + 4;
  const valueEnd = valueStart + length;
  if (valueEnd > limit) {
    throw new Error("Length-prefixed value exceeds its container");
  }

  return {
    bytes: bytes.subarray(valueStart, valueEnd),
    nextOffset: valueEnd,
  };
}

function collectX509CertificatesFromDer(bytes) {
  const certificates = [];
  const seen = new Set();
  collectX509CertificatesFromDerRange(bytes, 0, bytes.byteLength, certificates, seen, 0);
  return certificates;
}

function collectX509CertificatesFromDerRange(bytes, start, limit, certificates, seen, depth) {
  if (depth > 16) {
    return;
  }

  let offset = start;
  while (offset < limit) {
    let element;
    try {
      element = readDerElement(bytes, offset, limit);
    } catch {
      return;
    }

    if (element.tag === 0x30) {
      const certificateBytes = bytes.subarray(element.start, element.end);
      if (looksLikeX509Certificate(certificateBytes)) {
        const key = bytesToHex(certificateBytes, "");
        if (!seen.has(key)) {
          seen.add(key);
          certificates.push(certificateBytes);
        }
      }
    }

    if (isConstructedDerTag(element.tag)) {
      collectX509CertificatesFromDerRange(bytes, element.valueStart, element.valueEnd, certificates, seen, depth + 1);
    }

    offset = element.end;
  }
}

function looksLikeX509Certificate(bytes) {
  try {
    parseX509CertificateFields(bytes);
    return true;
  } catch {
    return false;
  }
}

function parseX509CertificateFields(certificateBytes) {
  const bytes = toUint8Array(certificateBytes);
  const root = readDerElement(bytes, 0, bytes.byteLength);
  if (root.tag !== 0x30 || root.end !== bytes.byteLength) {
    throw new Error("Invalid X.509 certificate wrapper");
  }

  const certificateChildren = readDerChildren(bytes, root);
  if (certificateChildren.length < 3 || certificateChildren[0].tag !== 0x30 || certificateChildren[1].tag !== 0x30 || certificateChildren[2].tag !== 0x03) {
    throw new Error("Invalid X.509 certificate structure");
  }

  const tbsCertificate = certificateChildren[0];
  const tbsChildren = readDerChildren(bytes, tbsCertificate);
  let offset = 0;
  let version = 1;

  if (tbsChildren[offset]?.tag === 0xa0) {
    const versionChildren = readDerChildren(bytes, tbsChildren[offset]);
    if (versionChildren[0]?.tag === 0x02) {
      version = Number(parseDerInteger(bytes, versionChildren[0]).value) + 1;
    }
    offset += 1;
  }

  const serialNumber = parseDerInteger(bytes, tbsChildren[offset]);
  offset += 1;
  offset += 1;
  const issuer = parseDistinguishedName(bytes, tbsChildren[offset]);
  offset += 1;
  const validity = parseCertificateValidity(bytes, tbsChildren[offset]);
  offset += 1;
  const subject = parseDistinguishedName(bytes, tbsChildren[offset]);
  offset += 1;
  const publicKey = parseSubjectPublicKeyInfo(bytes, tbsChildren[offset]);
  const signatureAlgorithm = parseAlgorithmIdentifier(bytes, certificateChildren[1]);

  return {
    version,
    serialNumber: {
      decimal: serialNumber.decimal,
      hex: serialNumber.hex,
    },
    issuer,
    subject,
    validity,
    publicKey,
    signatureAlgorithm,
  };
}

function parseCertificateValidity(bytes, element) {
  const children = readDerChildren(bytes, element);
  return {
    notBefore: parseDerTime(bytes, children[0]),
    notAfter: parseDerTime(bytes, children[1]),
  };
}

function parseSubjectPublicKeyInfo(bytes, element) {
  const children = readDerChildren(bytes, element);
  const algorithm = parseAlgorithmIdentifier(bytes, children[0]);
  const publicKeyBytes = parseDerBitString(bytes, children[1]);
  const result = {
    format: "X.509",
    algorithm: algorithm.name,
    algorithmOid: algorithm.oid,
  };

  if (algorithm.oid === "1.2.840.113549.1.1.1") {
    try {
      const keyRoot = readDerElement(publicKeyBytes, 0, publicKeyBytes.byteLength);
      const keyChildren = readDerChildren(publicKeyBytes, keyRoot);
      const modulus = parseDerInteger(publicKeyBytes, keyChildren[0]);
      const exponent = parseDerInteger(publicKeyBytes, keyChildren[1]);
      result.exponent = {
        decimal: exponent.decimal,
        hex: exponent.hex,
      };
      result.modulusSizeBits = getPositiveIntegerBitLength(modulus.normalizedBytes);
      result.modulusHex = bytesToHex(modulus.normalizedBytes, DIGEST_HEX_SEPARATOR, { upper: true });
    } catch {
      result.type = "RSA";
    }
  } else if (algorithm.oid === "1.2.840.10040.4.1") {
    try {
      const y = parseDerInteger(publicKeyBytes, readDerElement(publicKeyBytes, 0, publicKeyBytes.byteLength));
      result.y = y.decimal;
    } catch {
      result.type = "DSA";
    }
  } else {
    result.type = algorithm.name || "Unknown";
  }

  return result;
}

function parseAlgorithmIdentifier(bytes, element) {
  const children = readDerChildren(bytes, element);
  const oid = parseObjectIdentifier(bytes, children[0]);
  return {
    oid,
    name: X509_ALGORITHM_NAMES.get(oid) || oid,
  };
}

function parseDistinguishedName(bytes, element) {
  if (!element || element.tag !== 0x30) {
    return "";
  }

  const attributes = [];
  for (const setElement of readDerChildren(bytes, element)) {
    if (setElement.tag !== 0x31 && setElement.tag !== 0x30) {
      continue;
    }

    for (const attributeElement of readDerChildren(bytes, setElement)) {
      if (attributeElement.tag !== 0x30) {
        continue;
      }

      const attributeChildren = readDerChildren(bytes, attributeElement);
      if (attributeChildren.length < 2) {
        continue;
      }

      const oid = parseObjectIdentifier(bytes, attributeChildren[0]);
      const label = X509_NAME_ATTRIBUTE_LABELS.get(oid) || oid;
      const value = parseDerStringValue(bytes, attributeChildren[1]);
      attributes.push(`${label}=${value}`);
    }
  }

  return attributes.join(", ");
}

function parseObjectIdentifier(bytes, element) {
  if (!element || element.tag !== 0x06) {
    throw new Error("Invalid object identifier");
  }

  const subIdentifiers = [];
  let value = 0n;
  for (let offset = element.valueStart; offset < element.valueEnd; offset += 1) {
    value = (value << 7n) | BigInt(bytes[offset] & 0x7f);
    if ((bytes[offset] & 0x80) === 0) {
      subIdentifiers.push(value);
      value = 0n;
    }
  }

  if (!subIdentifiers.length) {
    return "";
  }

  const firstValue = subIdentifiers[0];
  let firstArc;
  let secondArc;
  if (firstValue < 40n) {
    firstArc = 0n;
    secondArc = firstValue;
  } else if (firstValue < 80n) {
    firstArc = 1n;
    secondArc = firstValue - 40n;
  } else {
    firstArc = 2n;
    secondArc = firstValue - 80n;
  }

  return [firstArc, secondArc, ...subIdentifiers.slice(1)].map((part) => part.toString()).join(".");
}

function parseDerInteger(bytes, element) {
  if (!element || element.tag !== 0x02) {
    throw new Error("Invalid DER integer");
  }

  const rawBytes = bytes.subarray(element.valueStart, element.valueEnd);
  const normalizedBytes = normalizePositiveIntegerBytes(rawBytes);
  let value = 0n;
  for (const byte of normalizedBytes) {
    value = (value << 8n) | BigInt(byte);
  }

  return {
    value,
    decimal: value.toString(10),
    hex: `0x${bytesToHex(normalizedBytes, "", { upper: false })}`,
    normalizedBytes,
  };
}

function normalizePositiveIntegerBytes(bytes) {
  let offset = 0;
  while (offset < bytes.byteLength - 1 && bytes[offset] === 0) {
    offset += 1;
  }

  return bytes.subarray(offset);
}

function getPositiveIntegerBitLength(bytes) {
  if (!bytes.byteLength) {
    return 0;
  }

  let offset = 0;
  while (offset < bytes.byteLength - 1 && bytes[offset] === 0) {
    offset += 1;
  }

  const first = bytes[offset];
  let highBits = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    if ((first & (1 << bit)) !== 0) {
      highBits = bit + 1;
      break;
    }
  }

  return highBits + (bytes.byteLength - offset - 1) * 8;
}

function parseDerBitString(bytes, element) {
  if (!element || element.tag !== 0x03 || element.valueStart >= element.valueEnd) {
    throw new Error("Invalid DER bit string");
  }

  return bytes.subarray(element.valueStart + 1, element.valueEnd);
}

function parseDerTime(bytes, element) {
  const value = parseDerStringValue(bytes, element);
  if (!value) {
    return "";
  }

  if (element.tag === 0x17) {
    const match = value.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:(\d{2}))?(Z|[+-]\d{4})?$/u);
    if (match) {
      const shortYear = Number(match[1]);
      const year = shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear;
      return buildIsoDateFromAsn1Time(year, match);
    }
  }

  if (element.tag === 0x18) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:(\d{2}))?(?:\.\d+)?(Z|[+-]\d{4})?$/u);
    if (match) {
      return buildIsoDateFromAsn1Time(Number(match[1]), match);
    }
  }

  return value;
}

function buildIsoDateFromAsn1Time(year, match) {
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  const timezone = match[7] || "Z";
  let timestamp = Date.UTC(year, month, day, hour, minute, second);

  if (timezone !== "Z") {
    const sign = timezone[0] === "-" ? -1 : 1;
    const timezoneHours = Number(timezone.slice(1, 3));
    const timezoneMinutes = Number(timezone.slice(3, 5));
    timestamp -= sign * ((timezoneHours * 60 + timezoneMinutes) * 60 * 1000);
  }

  return new Date(timestamp).toISOString();
}

function parseDerStringValue(bytes, element) {
  if (!element) {
    return "";
  }

  const valueBytes = bytes.subarray(element.valueStart, element.valueEnd);
  if (element.tag === 0x0c) {
    return decodeUtf8(valueBytes);
  }

  if (element.tag === 0x1e) {
    let value = "";
    for (let offset = 0; offset + 1 < valueBytes.byteLength; offset += 2) {
      value += String.fromCharCode((valueBytes[offset] << 8) | valueBytes[offset + 1]);
    }
    return value;
  }

  if (element.tag === 0x05) {
    return "";
  }

  let value = "";
  for (const byte of valueBytes) {
    value += String.fromCharCode(byte);
  }
  return value;
}

function readDerElement(bytes, offset, limit) {
  ensureReadable(bytes, offset, 2);
  if (offset + 2 > limit) {
    throw new Error("DER element exceeds limit");
  }

  const tag = bytes[offset];
  const firstLengthByte = bytes[offset + 1];
  let length;
  let headerLength = 2;

  if ((firstLengthByte & 0x80) === 0) {
    length = firstLengthByte;
  } else {
    const lengthByteCount = firstLengthByte & 0x7f;
    if (lengthByteCount === 0 || lengthByteCount > 6) {
      throw new Error("Unsupported DER length");
    }

    ensureReadable(bytes, offset + 2, lengthByteCount);
    length = 0;
    for (let index = 0; index < lengthByteCount; index += 1) {
      length = length * 256 + bytes[offset + 2 + index];
    }
    headerLength += lengthByteCount;
  }

  const valueStart = offset + headerLength;
  const valueEnd = valueStart + length;
  if (valueEnd > limit || valueEnd > bytes.byteLength) {
    throw new Error("DER element length exceeds input");
  }

  return {
    tag,
    start: offset,
    headerLength,
    valueStart,
    valueEnd,
    end: valueEnd,
  };
}

function readDerChildren(bytes, element) {
  const children = [];
  let offset = element.valueStart;
  while (offset < element.valueEnd) {
    const child = readDerElement(bytes, offset, element.valueEnd);
    children.push(child);
    offset = child.end;
  }
  return children;
}

function isConstructedDerTag(tag) {
  return (tag & 0x20) !== 0;
}

async function computeCertificateFingerprints(bytes) {
  return {
    md5: formatDigestHex(md5Digest(bytes)),
    sha1: await computeCryptoDigestHex("SHA-1", bytes),
    sha256: await computeCryptoDigestHex("SHA-256", bytes),
  };
}

async function computeCryptoDigestHex(algorithm, bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    return "";
  }

  const digest = await subtle.digest(algorithm, bytes);
  return formatDigestHex(new Uint8Array(digest));
}

function md5Digest(inputBytes) {
  const bytes = toUint8Array(inputBytes);
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;

  const bitLength = BigInt(bytes.byteLength) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const words = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = readUint32(padded, offset + index * 4);
    }

    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;

    for (let index = 0; index < 64; index += 1) {
      let f;
      let g;
      if (index < 16) {
        f = (bb & cc) | (~bb & dd);
        g = index;
      } else if (index < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * index + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * index) % 16;
      }

      const previousD = dd;
      dd = cc;
      cc = bb;
      const sum = (aa + f + MD5_CONSTANTS[index] + words[g]) >>> 0;
      bb = (bb + rotateLeft32(sum, MD5_SHIFT_AMOUNTS[index])) >>> 0;
      aa = previousD;
    }

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  const digest = new Uint8Array(16);
  writeUint32(digest, 0, a);
  writeUint32(digest, 4, b);
  writeUint32(digest, 8, c);
  writeUint32(digest, 12, d);
  return digest;
}

function rotateLeft32(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function formatDigestHex(bytes) {
  return bytesToHex(bytes, DIGEST_HEX_SEPARATOR, { upper: true });
}

function bytesToHex(bytes, separator = "", options = {}) {
  const parts = [];
  for (const byte of bytes) {
    parts.push(byte.toString(16).padStart(2, "0"));
  }

  const value = parts.join(separator);
  return options.upper ? value.toUpperCase() : value;
}

function sortSignatureSchemes(schemes) {
  return schemes.filter(Boolean).sort(compareSignatureSchemeNames);
}

function compareSignatureSchemeNames(left, right) {
  return getSignatureSchemeOrder(left) - getSignatureSchemeOrder(right) || String(left || "").localeCompare(String(right || ""));
}

function getSignatureSchemeOrder(scheme) {
  const match = String(scheme || "").match(/^V(\d+)(?:\.(\d+))?$/u);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Number(match[1]) * 100 + Number(match[2] || 0);
}

function matchesBytes(bytes, offset, expected) {
  if (offset < 0 || offset + expected.byteLength > bytes.byteLength) {
    return false;
  }

  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[offset + index] !== expected[index]) {
      return false;
    }
  }

  return true;
}

function getErrorText(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

async function extractSourceEntry(source, entry) {
  return source.extractEntry(entry);
}

function entryExceedsSizeLimit(entry, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return false;
  }

  return (entry.uncompressedSize || entry.compressedSize || 0) > maxBytes;
}

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("APK ZIP 结束记录不存在");
}

function decodeUtf8(bytes) {
  return utf8Decoder.decode(bytes);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  return new Uint8Array(value);
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUint64(bytes, offset) {
  const low = BigInt(readUint32(bytes, offset));
  const high = BigInt(readUint32(bytes, offset + 4));
  const value = (high << 32n) | low;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("64-bit value exceeds safe integer range");
  }

  return Number(value);
}

function ensureReadable(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) {
    throw new Error("数据读取越界");
  }
}
