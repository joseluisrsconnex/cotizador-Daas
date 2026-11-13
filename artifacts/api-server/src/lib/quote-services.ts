import Decimal from "decimal.js";
import { SERVICE_UNITS, type PricingConfig, type QuoteServiceInput, type QuoteServiceSnapshot, type ServicePackageType, type TermMonths } from "@workspace/pricing";

const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
export class ServiceSelectionError extends Error { readonly status = 400; }

/** Resolve catalog prices on the server. Snapshot both catalog and quote-only services. */
export function resolveQuoteServices(
  input: QuoteServiceInput & { packageType: ServicePackageType | null; termMonths: TermMonths },
  config: PricingConfig,
  totalUnits: number,
): QuoteServiceSnapshot & { serviceUnitCost: Decimal } {
  const serviceMode = input.serviceMode ?? (input.packageType ? "Paquete" : "Servicios individuales");
  if (!Number.isSafeInteger(totalUnits) || totalUnits < 0)
    throw new ServiceSelectionError("La cantidad total de equipos debe ser un entero válido.");
  const selectedServices = (input.selectedServices ?? []).map(row => ({ ...row }));
  const customServices = (input.customServices ?? []).map(row => ({ ...row, name: row.name.trim() }));
  if (new Set(selectedServices.map(row => row.id)).size !== selectedServices.length ||
      new Set(customServices.map(row => row.id)).size !== customServices.length)
    throw new ServiceSelectionError("No repita servicios en la selección.");
  const includedServices: QuoteServiceSnapshot["includedServices"] = [];
  if (serviceMode === "Paquete") {
    const pack = config.servicePackages.find(row => row.packageType === input.packageType);
    if (!pack) throw new ServiceSelectionError("Seleccione un paquete de servicio.");
    if (selectedServices.length) throw new ServiceSelectionError("Los servicios del catálogo requieren el modo Servicios individuales.");
    includedServices.push({ id: `package:${pack.packageType}`, name: `Paquete ${pack.packageType}: ${pack.detail}`, unitCost: pack.unitCost, unit: "Por equipo" });
  } else if (serviceMode === "Servicios individuales") {
    if (input.packageType !== null) throw new ServiceSelectionError("No combine un paquete con servicios individuales.");
    for (const selected of selectedServices) {
      const service = config.individualServices.find(row => row.id === selected.id && row.active);
      if (!service) throw new ServiceSelectionError("Un servicio seleccionado ya no está disponible. Actualice el catálogo.");
    }
    for (const service of config.individualServices.filter(row => row.active)) {
      const selected = selectedServices.find(row => row.id === service.id);
      if (!selected && !service.mandatory) continue;
      includedServices.push({
        id: service.id, name: service.name, unitCost: service.unitCost, unit: service.unit,
        ...(["Por perfil", "Por evento", "Por equipo saliente"].includes(service.unit) ? { quantity: selected?.quantity } : {}),
        ...(service.unit === "Por equipo por evento" ? { events: selected?.events } : {}),
      });
    }
  } else throw new ServiceSelectionError("Seleccione un esquema de servicios válido.");
  for (const row of customServices) {
    if (!row.id.trim() || !row.name || row.name.length > 200 || !Number.isFinite(row.unitCost) || row.unitCost <= 0 ||
      !SERVICE_UNITS.includes(row.unit))
      throw new ServiceSelectionError("Complete el nombre, el costo USD mayor que cero y la unidad del servicio nuevo.");
    includedServices.push({ ...row, id: `custom:${row.id}` });
  }
  let serviceUnitCost = new Exact(0);
  // A license-only quotation never receives services, even when mandatory services are selected.
  if (totalUnits === 0) return { serviceMode, selectedServices, customServices, includedServices: [], serviceUnitCost };
  for (const service of includedServices) {
    let multiplier = new Exact(1);
    if (service.unit === "Por perfil" || service.unit === "Por evento" || service.unit === "Por equipo saliente") {
      if (!Number.isSafeInteger(service.quantity) || service.quantity! <= 0)
        throw new ServiceSelectionError(service.unit === "Por equipo saliente" ? "Indique la cantidad de equipos salientes, un entero mayor que cero." : "Indique una cantidad entera mayor que cero para cada servicio por perfil o por evento.");
      multiplier = new Exact(service.quantity!).div(totalUnits);
    } else if (service.unit === "Por año") multiplier = new Exact(input.termMonths).div(12).div(totalUnits);
    else if (service.unit === "Por equipo por evento") {
      const events = service.events ?? [];
      const quantity = events.find(e => e.termMonths === input.termMonths)?.quantity;
      if (new Set(events.map(e => e.termMonths)).size !== events.length || !Number.isSafeInteger(quantity) || quantity! < 1)
        throw new ServiceSelectionError(`Indique el número de mantenimientos preventivos para el periodo de ${input.termMonths} meses.`);
      multiplier = new Exact(quantity!);
    }
    serviceUnitCost = serviceUnitCost.plus(new Exact(service.unitCost).mul(multiplier));
  }
  return { serviceMode, selectedServices, customServices, includedServices, serviceUnitCost };
}
