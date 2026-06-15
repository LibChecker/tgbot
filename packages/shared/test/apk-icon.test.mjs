import assert from "node:assert/strict";
import test from "node:test";

import { __apkTestInternals } from "../src/apk.js";

const textEncoder = new TextEncoder();

test("renders stroked vector paths without implicit black fill", async () => {
  const vectorXml = textEncoder.encode(`
    <vector xmlns:android="http://schemas.android.com/apk/res/android"
        android:width="108dp"
        android:height="108dp"
        android:viewportWidth="24"
        android:viewportHeight="24">
      <path
          android:pathData="M12,3l8,4.5l0,9l-8,4.5l-8,-4.5l0,-9l8,-4.5"
          android:strokeColor="#ffff"
          android:strokeWidth="2"/>
    </vector>
  `);

  const icon = await __apkTestInternals.renderVectorDrawableIcon(
    vectorXml,
    {},
    { resolveColor: () => null },
    { path: "res/drawable/launcher_foreground.xml" },
  );
  const svg = decodeSvgDataUri(icon.dataUri);

  assert.match(svg, /fill="none"/u);
  assert.doesNotMatch(svg, /fill="#000000"/u);
  assert.match(svg, /stroke="#ffffff"/u);
});

function decodeSvgDataUri(dataUri) {
  const [, base64] = dataUri.split(",");
  return Buffer.from(base64, "base64").toString("utf8");
}
