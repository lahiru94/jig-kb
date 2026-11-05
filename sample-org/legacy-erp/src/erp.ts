// LEGACY ERP - finance postings and the nightly finance report.
// Written in 2014, ported to Node in 2019. Single file, own SQLite database. Please do not refactor.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import initSqlJs from "sql.js";

var PORT = Number(process.env.PORT || 4109);
var DB_FILE = process.env.ERP_DB_FILE || path.join(process.cwd(), "sample-org", "legacy-erp", "data", "erp.sqlite");
var NIGHTLY_HOUR_UTC = 2; // the finance job runs at 02:00 UTC

var SQL = await initSqlJs();
var db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();

db.run("CREATE TABLE IF NOT EXISTS SALES (ORDER_ID TEXT PRIMARY KEY, CUSTOMER_ID TEXT, AMOUNT_CENTS INTEGER, POSTED_AT TEXT)");
// One refund row per order. (Refunds are always for the whole order.)
db.run("CREATE TABLE IF NOT EXISTS REFUNDS (ORDER_ID TEXT PRIMARY KEY, AMOUNT_CENTS INTEGER, POSTED_AT TEXT)");
db.run("CREATE TABLE IF NOT EXISTS REPORTS (REPORT_DATE TEXT PRIMARY KEY, BODY TEXT)");

function save() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function rows(sql: string, params?: any[]) {
  var stmt = db.prepare(sql);
  stmt.bind(params || []);
  var out: any[] = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function post(body: any) {
  if (body.kind == "sale") {
    db.run("INSERT OR REPLACE INTO SALES VALUES (?, ?, ?, ?)", [body.order_id, body.customer_id || null, body.amount_cents, body.at]);
  } else if (body.kind == "refund") {
    db.run("INSERT OR REPLACE INTO REFUNDS VALUES (?, ?, ?)", [body.order_id, body.amount_cents, body.at]);
  } else {
    throw new Error("unknown posting kind " + body.kind);
  }
  save();
  return { ok: true };
}

// NIGHTLY FINANCE JOB: net revenue per order and in total, for postings up to the end of the given day.
function runNightlyFinance(date: string) {
  var cutoff = date + "T23:59:59.999Z";
  var lines = rows(
    "SELECT S.ORDER_ID AS order_id, S.AMOUNT_CENTS AS sales_cents, COALESCE(R.AMOUNT_CENTS, 0) AS refunds_cents " +
      "FROM SALES S LEFT JOIN REFUNDS R ON R.ORDER_ID = S.ORDER_ID AND R.POSTED_AT <= ? " +
      "WHERE S.POSTED_AT <= ? ORDER BY S.ORDER_ID",
    [cutoff, cutoff],
  );
  var totalSales = 0;
  var totalRefunds = 0;
  for (var i = 0; i < lines.length; i++) {
    lines[i].net_cents = lines[i].sales_cents - lines[i].refunds_cents;
    totalSales += lines[i].sales_cents;
    totalRefunds += lines[i].refunds_cents;
  }
  var report = { date: date, lines: lines, total_sales_cents: totalSales, total_refunds_cents: totalRefunds, net_cents: totalSales - totalRefunds };
  db.run("INSERT OR REPLACE INTO REPORTS VALUES (?, ?)", [date, JSON.stringify(report)]);
  save();
  return report;
}

// Finance's definition: a customer is active if they bought something in the last 12 months.
function activeCustomers(asOf: string) {
  var from = new Date(asOf);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return rows("SELECT DISTINCT CUSTOMER_ID AS c FROM SALES WHERE POSTED_AT >= ? AND POSTED_AT <= ? ORDER BY c", [from.toISOString(), asOf]).map(
    function (r: any) {
      return r.c;
    },
  );
}

function reply(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

var server = http.createServer(function (req, res) {
  var data = "";
  req.on("data", function (chunk) {
    data += chunk;
  });
  req.on("end", function () {
    try {
      var url = new URL(req.url || "/", "http://localhost");
      var body = data ? JSON.parse(data) : {};
      if (req.method == "GET" && url.pathname == "/health") return reply(res, 200, { service: "legacy-erp", ok: true });
      if (req.method == "POST" && url.pathname == "/postings") return reply(res, 201, post(body));
      if (req.method == "POST" && url.pathname == "/jobs/nightly-finance/run") return reply(res, 201, runNightlyFinance(body.date));
      if (req.method == "GET" && url.pathname.indexOf("/reports/") == 0) {
        var found = rows("SELECT BODY FROM REPORTS WHERE REPORT_DATE = ?", [url.pathname.substring(9)]);
        return found.length ? reply(res, 200, JSON.parse(found[0].BODY)) : reply(res, 404, { error: "no report" });
      }
      if (req.method == "GET" && url.pathname == "/finance/active-customers") {
        return reply(res, 200, activeCustomers(url.searchParams.get("as_of") || new Date().toISOString()));
      }
      if (req.method == "POST" && url.pathname == "/admin/reset") {
        db.run("DELETE FROM SALES");
        db.run("DELETE FROM REFUNDS");
        db.run("DELETE FROM REPORTS");
        save();
        return reply(res, 201, { ok: true });
      }
      reply(res, 404, { error: "not found" });
    } catch (e: any) {
      reply(res, 500, { error: String(e && e.message) });
    }
  });
});

// Cron: run the finance job for the previous day at NIGHTLY_HOUR_UTC.
setInterval(function () {
  var now = new Date();
  if (now.getUTCHours() == NIGHTLY_HOUR_UTC && now.getUTCMinutes() == 0) {
    var y = new Date(now.getTime() - 86400000).toISOString().substring(0, 10);
    runNightlyFinance(y);
  }
}, 60000).unref();

server.listen(PORT, function () {
  console.log("legacy-erp listening on " + PORT);
});
