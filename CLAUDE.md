# CLAUDE.md

## Line endings

This repo's files use **CRLF** (Windows) line endings — the project is
developed on Windows (see `build.py` / `serve.bat`). Only `save.js` and
`structure.md` are LF; everything else is CRLF. Preserve this; don't
convert the repo to LF.

When editing files here:

- **Small/targeted edits**: don't rewrite the whole file (e.g. via a plain
  `Write`/upload of full file content) — that silently flips every line's
  ending to LF and produces a noisy whole-file diff even when only one
  line actually changed. Instead, edit with `bash`/`perl` against the
  specific line(s), e.g.:
  ```bash
  perl -i -pe 's/(pattern\r\n)/$1new line here\r\n/' file.js
  ```
  This touches only the lines that need to change and leaves every other
  line's `\r\n` untouched.

- **Large/complex changes within one file**: the `Edit` tool's exact-match
  + uniqueness check is safer than hand-written regex for this. In that
  case: normalize just that file to LF, make the edit(s) with `Edit`, then
  convert it back to CRLF before committing:
  ```bash
  sed -i 's/\r$//' file.js   # LF for editing
  # ... use Edit tool ...
  sed -i 's/$/\r/' file.js   # restore CRLF
  ```

- Either way, run `git diff` before committing to confirm only the
  intended lines changed (no accidental line-ending flip across the
  whole file).
