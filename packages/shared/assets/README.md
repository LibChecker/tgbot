# Local feature icons

`ic_gradle.svg` is derived from LibChecker's
`app/src/main/res/drawable/ic_gradle.xml` at commit
`40f378a1cc370ffffc443970f7dd40754e7a532d` (Apache-2.0).
Source: https://github.com/LibChecker/LibChecker/blob/40f378a1cc370ffffc443970f7dd40754e7a532d/app/src/main/res/drawable/ic_gradle.xml
The Android theme color is represented as neutral black (the existing UI themes monochrome SVGs); geometry and clip
are retained. This feature icon is independent of the library rules release.

`ic_sdk_placeholder.svg` preserves the legacy LibChecker-Rules-Bundle
`library/src/main/res/drawable/ic_sdk_placeholder.xml` SDK fallback (Apache-2.0),
at commit `178fa5c6e4ebe1d3f6edec09e71c53e566fc931d`. Its conversion is byte-equivalent
to the previous tgbot runtime output.
Source: https://github.com/LibChecker/LibChecker-Rules-Bundle/blob/178fa5c6e4ebe1d3f6edec09e71c53e566fc931d/library/src/main/res/drawable/ic_sdk_placeholder.xml

It handles the portable schema's null `iconId` without assigning a new library icon ID.
