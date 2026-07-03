#!/usr/bin/env node
/**
 * health-mcp: Streamable HTTP MCP server for toge's health data
 *
 * Reads from /root/.cyberboss/health/YYYY-MM-DD.json (same dir as cyberboss writes to).
 * Exposes tools: health_read, health_summary
 *
 * Usage: node index.js
 * Env:
 *   PORT               — listen port (default 3100)
 *   HEALTH_DATA_DIR    — data directory (default ~/.cyberboss/health)
 *   MCP_AUTH_TOKEN     — optional Bearer token for auth (same as CYBERBOSS_HEALTH_TOKEN)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

const PORT = parseInt(process.env.PORT || "3100", 10);
const HEALTH_DIR = process.env.HEALTH_DATA_DIR || path.join(os.homedir(), ".cyberboss", "health");
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

function formatShanghaiDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function readHealthRecords(days, type) {
  const records = [];
  if (!fs.existsSync(HEALTH_DIR)) return records;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = formatShanghaiDate(d);
    const filePath = path.join(HEALTH_DIR, `${date}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (type && type !== "all") {
        const filtered = { date: record.date || date };
        if (record[type]) filtered[type] = record[type];
        records.push(filtered);
      } else {
        records.push(record);
      }
    } catch {}
  }
  return records;
}

function buildSummaryText(records) {
  if (!records.length) return "No health data available.";
  const lines = [];
  for (const r of records) {
    const parts = [];
    if (r.steps?.total) parts.push(`步数 ${r.steps.total}`);
    if (r.heart_rate?.avg) parts.push(`心率均值 ${r.heart_rate.avg} bpm${r.heart_rate.resting ? `(静息 ${r.heart_rate.resting})` : ""}`);
    if (r.sleep) {
      const s = r.sleep;
      const dur = s.duration_min ? `${Math.floor(s.duration_min / 60)}h${s.duration_min % 60}m` : "";
      const deep = s.deep_min ? ` 深睡 ${s.deep_min}min` : "";
      parts.push(`睡眠 ${dur}${deep}${s.score ? ` 评分${s.score}` : ""}`);
    }
    lines.push(`${r.date}: ${parts.join(", ") || "无数据"}`);
  }
  return lines.join("\n");
}

const server = new McpServer({
  name: "health-mcp",
  version: "1.0.0",
});

server.tool(
  "health_read",
  "Read toge's health data (steps, heart_rate, sleep). Returns daily records.",
  {
    days: z.number().int().min(1).max(30).optional().describe("Days to read (default 7)"),
    type: z.enum(["steps", "heart_rate", "sleep", "all"]).optional().describe("Data type filter (default all)"),
  },
  async ({ days = 7, type = "all" }) => {
    const records = readHealthRecords(days, type);
    return {
      content: [
        {
          type: "text",
          text: records.length
            ? JSON.stringify(records, null, 2)
            : "No health data found.",
        },
      ],
    };
  }
);

server.tool(
  "health_summary",
  "Get a human-readable summary of toge's recent health data.",
  {
    days: z.number().int().min(1).max(30).optional().describe("Days to summarize (default 7)"),
  },
  async ({ days = 7 }) => {
    const records = readHealthRecords(days, "all");
    return {
      content: [
        {
          type: "text",
          text: buildSummaryText(records),
        },
      ],
    };
  }
);

// Stateless Streamable HTTP: one transport per request
const httpServer = http.createServer(async (req, res) => {
  // CORS for Claude APP connector
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Auth check (optional)
  if (AUTH_TOKEN) {
    const authHeader = req.headers["authorization"] || "";
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  // Health check
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "health-mcp" }));
    return;
  }

  // MCP endpoint
  if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[health-mcp] request error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    } finally {
      await transport.close().catch(() => {});
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[health-mcp] listening on http://0.0.0.0:${PORT}/mcp`);
  console.log(`[health-mcp] health data dir: ${HEALTH_DIR}`);
  console.log(`[health-mcp] auth: ${AUTH_TOKEN ? "enabled" : "disabled (open)"}`);
});
