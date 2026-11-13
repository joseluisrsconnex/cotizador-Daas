import { BRAND } from "@/lib/brand";

/** Use the same lockup in quote headers and future PDF/print exports. */
export default function BrandLogo({
  variant = "violet",
  className = "",
}: {
  variant?: "violet" | "white";
  className?: string;
}) {
  return (
    <img
      className={`novotechno-logo ${className}`}
      src={variant === "white" ? BRAND.whiteLogo : BRAND.logo}
      alt="Novotechno Servicios"
      width={1842}
      height={470}
    />
  );
}
