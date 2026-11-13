const assetBase = `${import.meta.env.BASE_URL}brand/`;

export const BRAND = {
  name: "Novotechno",
  applicationName: "Novotechno · Cotizador DaaS",
  primaryColor: "#6D31FA",
  logo: `${assetBase}novotechno-logo-nts.png`,
  whiteLogo: `${assetBase}novotechno-logo-nts.png`,
  favicon: `${assetBase}novotechno-nts-favicon.png`,
} as const;
