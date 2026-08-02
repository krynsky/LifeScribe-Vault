# LifeScribe Vault branding

The generated assets use the published LifeScribe wordmark in
`source-lifescribe-logo.png` and add the Vault shield mark.

Regenerate the shared in-app, favicon, and installer artwork from this directory:

```powershell
python -m pip install -r requirements.txt
python generate_brand_assets.py
```

Then regenerate the native shortcut and application icon set from the repository
root:

```powershell
npm --prefix apps/desktop run tauri -- icon apps/desktop/branding/lifescribe-vault-app-icon.png
```

The Tauri icon command also creates mobile assets. This desktop project ignores
the generated `android/`, `ios/`, and `64x64.png` outputs while keeping the
desktop and Windows Store icon set.
