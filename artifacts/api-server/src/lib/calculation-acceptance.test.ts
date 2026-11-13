import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { PreviewQuoteBody, CreateSavedQuoteBody } from "@workspace/api-zod";
import { priceScenarios } from "./quote-scenarios";
import { priceQuote, quoteConfigRevision, QUOTE_UNAVAILABLE } from "./quote-pricing";
import { resolveQuoteServices } from "./quote-services";
import { calculationConfig, commonRows } from "../test/fixtures/calculation-config";

// Absolute tolerance on displayed USD (cents), never relative/percentage.
// The engine still accumulates unrounded amounts; do not round each line first.
const money = (actual: Decimal.Value, expected: number) =>
  expect(new Decimal(actual).toDecimalPlaces(2).minus(expected).abs().toNumber()).toBeLessThanOrEqual(.01);
const packageInput = () => ({
  termMonths: 12 as const, terms: [12, 36, 60] as Array<12 | 36 | 60>,
  packageType: "Básico" as const, deliveryStatus: "Local" as const, rows: commonRows(),
});

describe("Compatibilidad de entrada Básico, tres escenarios y garantías (configuración fija)", () => {
  const expected = [
    { term: 12, margin: .05, service: 3.9815, spare: [1248.98, 1124.44, 880], unit: [98.89, 89.43, 91.57], line: [4944.65, 3577.18, 457.87], total: 8979.70 },
    { term: 36, margin: .05, service: 1.6519, spare: [1311.43, 1175.56, 924], unit: [51.83, 46.63, 39.81], line: [2591.42, 1865.19, 199.06], total: 4655.67 },
    { term: 60, margin: .05, service: 1.2113, spare: [1373.88, 1226.67, 968], unit: [42.82, 38.36, 30.52], line: [2140.76, 1534.29, 152.62], total: 3827.67 },
  ];
  for (const golden of expected) it(`${golden.term} meses: costos con spare, canon unitario, por fila y total ±0,01`, () => {
    const input = packageInput();
    const result = priceScenarios(input, calculationConfig());
    expect(result.scenarios.map(row => row.termMonths)).toEqual([12, 36, 60]);
    const scenario = result.scenarios.find(row => row.termMonths === golden.term)!;
    scenario.results.forEach((row, index) => {
      money(row.canonPaquetePorUnidad, golden.service);
      money(row.canonUnitarioMensual, golden.unit[index]!);
      money(row.canonMensualTotal, golden.line[index]!);
      // Recover the engine's financed cost from its product canon using the
      // independent annuity equation, not another call to the pricing engine.
      const growth = new Decimal("1.02").pow(golden.term);
      const annuityFactor = new Decimal(.02).div(new Decimal(1).minus(growth.pow(-1)));
      const financedPerUnit = new Decimal(row.canonProducto).div(row.quantity)
        .div(annuityFactor.mul(new Decimal(1).minus(new Decimal(row.residual).div(growth))));
      money(financedPerUnit.mul(new Decimal(1).minus(golden.margin)), golden.spare[index]!);
    });
    money(scenario.totalMonthlyBeforeTax, golden.total);
    expect(new Decimal(scenario.totalMonthlyBeforeTax).minus(
      scenario.results.reduce((sum, row) => sum.plus(row.canonMensualTotal), new Decimal(0)),
    ).abs().toNumber()).toBeLessThan(1e-12);
    if (golden.term === 12) {
      expect(new Decimal(scenario.totalMonthlyBeforeTax).toFixed(2)).toBe("8979.70");
    }
  });
});

describe("Aceptación B: servicios individuales, 36 meses sin extensiones", () => {
  it("58 por equipo + 980 prorrateados entre 95 unidades y residual de servicios cero", () => {
    const config = calculationConfig();
    const input = {
      termMonths: 36 as const, terms: [36 as const], packageType: null, deliveryStatus: "Local" as const,
      serviceMode: "Servicios individuales" as const, rows: commonRows(false),
      selectedServices: [{ id: "clonacion" }, { id: "creacion-imagen", quantity: 2 }],
      customServices: [
        { id: "instalacion", name: "Instalación en sitio", unit: "Por evento" as const, unitCost: 100, quantity: 3 },
        { id: "soporte", name: "Soporte anual", unit: "Por año" as const, unitCost: 200 },
      ],
    };
    const resolved = resolveQuoteServices(input, config, 95);
    const perEquipment = resolved.includedServices.filter(row => row.unit === "Por equipo");
    expect(perEquipment.reduce((sum, row) => sum + row.unitCost, 0)).toBe(58);
    expect(40 * 2 + 100 * 3 + 200 * (36 / 12)).toBe(980);
    expect(resolved.serviceUnitCost.minus(new Decimal(58).plus(new Decimal(980).div(95))).abs().toNumber()).toBeLessThan(1e-12);
    const onlyEquipment = priceQuote({ ...input, selectedServices: [{ id: "clonacion" }], customServices: [] }, config);
    const result = priceScenarios(input, config);
    const expectedUnit = [50.61, 45.84, 39.16], expectedLine = [2530.42, 1833.75, 195.82];
    result.results.forEach((row, index) => {
      money(onlyEquipment.results[index]!.canonPaquetePorUnidad, 2.3953);
      money(new Decimal(row.canonPaquetePorUnidad).minus(onlyEquipment.results[index]!.canonPaquetePorUnidad), .4260);
      money(row.canonUnitarioMensual, expectedUnit[index]!);
      money(row.canonMensualTotal, expectedLine[index]!);
    });
    // Nonzero asset residual must not be applied to the service component.
    money(new Decimal(resolved.serviceUnitCost).div(.95).mul(.02).div(new Decimal(1).minus(new Decimal("1.02").pow(-36))), Number(result.results[0]!.canonPaquetePorUnidad));
    expect(result.scenarios).toHaveLength(1);
    money(result.totalMonthlyBeforeTax, 4559.98);
  });
});

describe("Aceptación C: validaciones con configuración fija", () => {
  it("no permite excluir obligatorios en frontend ni omitirlos del cálculo backend", () => {
    const config = calculationConfig();
    const source = readFileSync(new URL("../../../cotizador-daas/src/components/quote-service-scheme.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/disabled=\{service\.mandatory\}/);
    const backend = resolveQuoteServices({ serviceMode: "Servicios individuales", packageType: null, termMonths: 36, selectedServices: [] }, config, 95);
    expect(backend.includedServices.map(row => row.id).sort()).toEqual(config.individualServices.filter(row => row.mandatory).map(row => row.id).sort());
  });
  it("Objetivo inferior a Mínimo devuelve el error seguro 422", () => {
    const config = calculationConfig();
    config.margins.find(row => row.termMonths === 36)!.target = .13;
    expect(() => priceScenarios(packageInput(), config)).toThrow(QUOTE_UNAVAILABLE);
    try { priceScenarios(packageInput(), config); expect.fail("Debe rechazarse"); }
    catch (error) { expect(error).toMatchObject({ status: 422, message: QUOTE_UNAVAILABLE }); }
  });
  it.each([
    { name: "" }, { unitCost: 0 }, { unitCost: -1 }, { unit: undefined },
  ])("rechaza un servicio nuevo incompleto: %j", invalid => {
    const body = { ...packageInput(), customServices: [{ id: "test", name: "Servicio nuevo", unitCost: 20, unit: "Por equipo", ...invalid }] };
    expect(PreviewQuoteBody.safeParse({ ...packageInput(), customServices: [{ id: "test", name: "Servicio nuevo", unitCost: 20, unit: "Por equipo" }] }).success).toBe(true);
    expect(PreviewQuoteBody.safeParse(body).success).toBe(false);
    expect(CreateSavedQuoteBody.safeParse({ ...body, requestId: "11111111-1111-4111-8111-111111111111", customer: "Test", expectedRevision: quoteConfigRevision(calculationConfig()) }).success).toBe(false);
    expect(() => resolveQuoteServices({
      serviceMode: "Servicios individuales", packageType: null, termMonths: 36,
      customServices: body.customServices as Parameters<typeof resolveQuoteServices>[0]["customServices"],
    }, calculationConfig(), 95)).toThrow("Complete el nombre");
  });
  it("extensión ausente bloquea; cero escrito permite cálculo", () => {
    const input = { ...packageInput(), terms: [12, 36] as Array<12 | 36>, rows: commonRows(false) };
    expect(() => priceScenarios(input, calculationConfig())).toThrow("Indique el costo de extensión de garantía a 36 meses para E14.");
    input.rows = input.rows.map(row => ({ ...row, warrantyExtensions: [{ termMonths: 36, unitCost: 0 }] }));
    expect(priceScenarios(input, calculationConfig()).scenarios).toHaveLength(2);
  });
  it.each([undefined, ""])("sin entrega (%j) no calcula ni guarda", deliveryStatus => {
    const body = { ...packageInput(), deliveryStatus };
    expect(PreviewQuoteBody.safeParse(body).success).toBe(false);
    expect(CreateSavedQuoteBody.safeParse({ ...body, requestId: "11111111-1111-4111-8111-111111111111", customer: "Test", expectedRevision: "test" }).success).toBe(false);
    expect(() => priceScenarios(body as ReturnType<typeof packageInput>, calculationConfig())).toThrow("Seleccione el estado de entrega");
  });
});
