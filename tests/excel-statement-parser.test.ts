import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  excelDate,
  parseExcelStatement,
  parseStatementRows,
} from "../src/excel-statement-parser.ts";

const categories = ["Grocery", "Hotel & Restaurant", "Petrol", "Fees"];

const iciciRows = [
  ["Statement for account"],
  ["S No.", "Value Date", "Transaction Date", "Cheque Number", "Transaction Remarks", "Withdrawal", "Deposit", "Balance"],
  ["", "", "", "", "", "Amount (INR)", "Amount (INR)", "(INR)"],
  [1, "01/07/2026", "01/07/2026", "", "UPI/JAGDISH FQ", 110, "", 1009.96],
  [2, "01/07/2026", "01/07/2026", "", "UPI/COMPASS IN", 10, "", 999.96],
  [3, "01/07/2026", "01/07/2026", "", "UPI/KARDANI AN", 170, "", 829.96],
  [4, "01/07/2026", "01/07/2026", "", "LANCESOFT INDIA PRIVATE LIMITED", "", 217230, 218059.96],
  [5, "02/07/2026", "02/07/2026", "", "HOTEL RANG", 314, "", 217745.96],
  [6, "02/07/2026", "02/07/2026", "", "Dimple", 150000, "", 67745.96],
];

test("Excel date conversion supports ICICI text and Excel serial dates", () => {
  assert.equal(excelDate("01/07/2026"), "2026-07-01");
  assert.equal(excelDate("2026-07-02"), "2026-07-02");
  assert.match(excelDate(46204), /^\d{4}-\d{2}-\d{2}$/);
});

test("ICICI Excel rows import withdrawals and exclude deposits and balances", () => {
  const result = parseStatementRows(iciciRows, categories, [], "ICICI");
  assert.equal(result.matched, true);
  assert.equal(result.skippedCredits, 1);
  assert.deepEqual(result.rows.map(row => row.amount), [110, 10, 170, 314, 150000]);
  assert.equal(result.rows.some(row => row.amount === 217230), false);
  assert.equal(result.rows.some(row => row.amount === 1009.96), false);
});

test("Workbook import detects duplicates against existing expenses", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(iciciRows), "Statement");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const result = parseExcelStatement(bytes, categories, [{
    name: "UPI/JAGDISH FQ",
    amount: 110,
    date: "2026-07-01",
  }]);
  assert.equal(result.sheetsRead, 1);
  assert.equal(result.matchedSheets, 1);
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[0].duplicate, true);
  assert.equal(result.rows[0].selected, false);
});
