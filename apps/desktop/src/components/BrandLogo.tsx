import logoUrl from "../assets/lifescribe-vault-logo.png";

export interface BrandLogoProps {
  className?: string;
}

/** Shared LifeScribe wordmark with the Vault shield badge. */
export function BrandLogo({ className = "" }: BrandLogoProps) {
  const classes = ["brand-logo", className].filter(Boolean).join(" ");
  return (
    <img
      alt="LifeScribe Vault"
      className={classes}
      height={352}
      src={logoUrl}
      width={1272}
    />
  );
}
