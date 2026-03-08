# FamHack Poster

This folder contains a landscape A3 LaTeX poster that matches the site's palette, fonts, and overall visual language.

## Compile

From `/Users/ace/Downloads/FamHack/poster`:

```sh
tectonic famhack-poster.tex --outdir output
```

The source uses:

- `fontspec`
- `tikz` with `calc`, `decorations.text`, `positioning`, `arrows.meta`, `backgrounds`
- `microtype`
- `graphicx`
- `geometry`
- `xcolor`

## QR code

If you want a real QR code instead of the styled placeholder, add this file:

`/Users/ace/Downloads/FamHack/poster/assets/images/qr-code.png`

The poster will pick it up automatically.

## Overleaf

The poster is self-contained apart from the TeX package download step. If your local TeX setup is missing any of the packages above, upload the whole `poster/` folder to Overleaf and compile there.
