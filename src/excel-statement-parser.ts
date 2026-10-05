import * as XLSXModule from "xlsx";
const XLSX = XLSXModule;

export type StatementEntry = {
  name: string;
  amount: number;
  date?: string;
};

export type ImportedTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  selected: boolean;
  duplicate: boolean;
};

export type ExcelStatementResult = {
  rows: ImportedTransaction[];
  sheetsRead: number;
  matchedSheets: number;
  skippedCredits: number;
};

type HeaderLayout = {
  headerEnd: number;
  date: number;
  description: number;
  debit: number;
  credit: number | null;
};

const text = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const headerText = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[₹()]/g, " ")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const amountValue = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.abs(value) : 0;
  }
  const cleaned = text(value)
    .replace(/\b(?:INR|RS\.?|DR|DB|DEBIT|CR|CREDIT)\b/gi, "")
    .replace(/[₹,\s]/g, "")
    .replace(/\/-$/, "")
    .replace(/[()]/g, "");
  if (!cleaned || cleaned === "-") return 0;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
};

const isoDate = (year: number, month: number, day: number) => {
  if (!year || !month || !day || month > 12 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const excelDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && value > 1) {
    const parsed = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return isoDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }

  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(raw)) {
    const [year, month, day] = raw.slice(0, 10).split("-").map(Number);
    return isoDate(year, month, day);
  }
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return "";
  const year = Number(match[3]) < 100 ? Number(match[3]) + 2000 : Number(match[3]);
  return isoDate(year, Number(match[2]), Number(match[1]));
};

const statementKey = (date: string, description: string, amount: number) =>
  `${date}|${description.toLowerCase().replace(/\s+/g, " ").trim()}|${Math.round(amount * 100)}`;

const suggestCategory = (description: string, categories: string[]) => {
  const value = description.toLowerCase();
  const rules: [RegExp, string[]][] = [
    [/school|tuition|books|stationery|uniform|class|activity/, ["Fees", "Stationery", "School Other"]],
    [/property tax|municipal/, ["Municipal Tax"]],
    [/electric|torrent|ugvcl/, ["Electricity Bill", "Property Electricity"]],
    [/gas|adani gas/, ["Gas Bill", "Property Gas Bill"]],
    [/maintenance|society|water/, ["Maintenance", "Home Maintenance", "Water Bill"]],
    [/petrol|fuel|hpcl|iocl|bpcl/, ["Petrol"]],
    [/restaurant|hotel|cafe|swiggy|zomato|food/, ["Hotel & Restaurant"]],
    [/grocery|dmart|reliance fresh|bigbasket|blinkit/, ["Grocery"]],
    [/internet|broadband|jio|airtel|mobile/, ["Internet Bill"]],
    [/car wash|car service|garage|tyre/, ["Car Cleaning", "Car Maintenance"]],
  ];
  for (const [pattern, choices] of rules) {
    if (!pattern.test(value)) continue;
    const match = choices.find(choice => categories.includes(choice));
    if (match) return match;
  }
  return categories.includes("Grocery") ? "Grocery" : categories[0] || "Other";
};

const findColumn = (headers: string[], patterns: RegExp[]) =>
  headers.findIndex(value => patterns.some(pattern => pattern.test(value)));

const detectHeader = (rows: unknown[][]): HeaderLayout | null => {
  const limit = Math.min(rows.length, 150);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const current = rows[rowIndex] || [];
    const next = rows[rowIndex + 1] || [];
    const width = Math.max(current.length, next.length);
    const currentHeaders = Array.from({ length: width }, (_, column) => headerText(current[column]));
    const combinedHeaders = Array.from({ length: width }, (_, column) =>
      headerText(`${text(current[column])} ${text(next[column])}`),
    );

    for (const [headers, headerEnd] of [
      [currentHeaders, rowIndex],
      [combinedHeaders, rowIndex + 1],
    ] as const) {
      const debit = findColumn(headers, [
        /\bwithdrawal(?: amount)?\b/,
        /\bdebit(?: amount)?\b/,
        /\bamount withdrawn\b/,
        /\bdr amount\b/,
      ]);
      const description = findColumn(headers, [
        /\btransaction remarks?\b/,
        /\bnarration\b/,
        /\bdescription\b/,
        /\bparticulars\b/,
        /\btransaction details?\b/,
        /\bremarks?\b/,
      ]);
      const exactTransactionDate = findColumn(headers, [
        /\btransaction date\b/,
        /\btxn date\b/,
        /\bposting date\b/,
      ]);
      const anyDate = findColumn(headers, [/\bdate\b/]);
      if (debit < 0 || description < 0 || (exactTransactionDate < 0 && anyDate < 0)) continue;
      const credit = findColumn(headers, [
        /\bdeposit(?: amount)?\b/,
        /\bcredit(?: amount)?\b/,
        /\bamount deposited\b/,
        /\bcr amount\b/,
      ]);
      return {
        headerEnd,
        date: exactTransactionDate >= 0 ? exactTransactionDate : anyDate,
        description,
        debit,
        credit: credit >= 0 ? credit : null,
      };
    }
  }
  return null;
};

export const parseStatementRows = (
  rows: unknown[][],
  categories: string[],
  existing: StatementEntry[],
  sheetName = "Statement",
) => {
  const layout = detectHeader(rows);
  if (!layout) return { rows: [] as ImportedTransaction[], matched: false, skippedCredits: 0 };

  const existingKeys = new Set(
    existing
      .filter(entry => entry.date)
      .map(entry => statementKey(entry.date!, entry.name, entry.amount)),
  );
  const seen = new Set<string>();
  const imported: ImportedTransaction[] = [];
  let skippedCredits = 0;

  for (let rowIndex = layout.headerEnd + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const date = excelDate(row[layout.date]);
    if (!date) continue;

    const debit = amountValue(row[layout.debit]);
    const credit = layout.credit === null ? 0 : amountValue(row[layout.credit]);
    if (credit > 0 && debit <= 0) {
      skippedCredits += 1;
      continue;
    }
    if (debit <= 0) continue;

    const description = text(row[layout.description]) || "Bank expense";
    const key = statementKey(date, description, debit);
    if (seen.has(key)) continue;
    seen.add(key);
    const duplicate = existingKeys.has(key);
    imported.push({
      id: `${sheetName}-${rowIndex}-${Math.round(debit * 100)}`,
      date,
      description,
      amount: debit,
      category: suggestCategory(description, categories),
      selected: !duplicate,
      duplicate,
    });
  }
  return { rows: imported, matched: true, skippedCredits };
};

export const parseExcelStatement = (
  data: ArrayBuffer,
  categories: string[],
  existing: StatementEntry[],
): ExcelStatementResult => {
  const workbook = XLSX.read(data, {
    type: "array",
    cellDates: true,
    raw: true,
    dense: true,
  });
  const imported: ImportedTransaction[] = [];
  let matchedSheets = 0;
  let skippedCredits = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });
    const result = parseStatementRows(rows, categories, existing, sheetName);
    if (result.matched) matchedSheets += 1;
    skippedCredits += result.skippedCredits;
    imported.push(...result.rows);
  }

  const unique = new Map<string, ImportedTransaction>();
  for (const row of imported) {
    const key = statementKey(row.date, row.description, row.amount);
    if (!unique.has(key)) unique.set(key, row);
  }
  return {
    rows: [...unique.values()],
    sheetsRead: workbook.SheetNames.length,
    matchedSheets,
    skippedCredits,
  };
};
