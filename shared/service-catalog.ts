import type { IndividualService } from "./pricing";

export const DEFAULT_INDIVIDUAL_SERVICES: IndividualService[] = [
  { id: "etiquetado", name: "Etiquetado", unitCost: 3, unit: "Por equipo", mandatory: true, active: true },
  { id: "logistica-entrega", name: "Logística de entrega de equipos", unitCost: 15, unit: "Por equipo", mandatory: true, active: true },
  { id: "creacion-imagen", name: "Creación de imagen", unitCost: 40, unit: "Por perfil", mandatory: false, active: true },
  { id: "clonacion", name: "Clonación", unitCost: 15, unit: "Por equipo", mandatory: false, active: true },
  { id: "migracion-informacion", name: "Migración de información", unitCost: 10, unit: "Por equipo", mandatory: false, active: true },
  { id: "entrega-acta", name: "Entrega de equipo y firma de acta", unitCost: 10, unit: "Por equipo", mandatory: false, active: true },
  { id: "mesa-ayuda", name: "Mesa de ayuda para garantías y siniestros", unitCost: 15, unit: "Por equipo", mandatory: true, active: true },
  { id: "borrado-seguro", name: "Borrado seguro", unitCost: 10, unit: "Por equipo", mandatory: false, active: true },
  { id: "logistica-inversa", name: "Logística inversa", unitCost: 10, unit: "Por equipo", mandatory: true, active: true },
  { id: "bios", name: "BIOS", unitCost: 8, unit: "Por equipo", mandatory: false, active: true },
  { id: "logistica-salientes", name: "Logística inversa (proveedor actual)", unitCost: 25, unit: "Por equipo saliente", mandatory: false, active: true },
  { id: "borrado-seguro-salientes", name: "Borrado seguro equipos salientes (proveedor actual)", unitCost: 10, unit: "Por equipo saliente", mandatory: false, active: true },
  { id: "mantenimiento-preventivo", name: "Mantenimiento preventivo", unitCost: 15, unit: "Por equipo por evento", mandatory: false, active: true },
  { id: "adicion-hardware", name: "Adición de hardware", unitCost: 15, unit: "Por equipo", mandatory: false, active: true },
];
