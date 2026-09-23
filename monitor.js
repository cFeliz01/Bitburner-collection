/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(1300, 700);
  ns.ui.setTailTitle("Server Monitor");

  const REFRESH_INTERVAL = 2000;
  const BAR_WIDTH = 14;
  const LOW_BALANCE_THRESHOLD = 0.5;   // below this % of max money counts as "low"
  const DELAYED_STREAK = 5;            // consecutive low readings before flagging DELAYED
  const RATE_SMOOTHING = 0.3;          // EMA weight for the new reading each refresh

  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const CYAN = "\x1b[36m";
  const MAGENTA = "\x1b[35m";
  const WHITE = "\x1b[97m";
  const GRAY = "\x1b[90m";

  // Persists across loop iterations within this one script instance — this is what
  // lets us compute a per-server $/sec rate and track how long a server has been low.
  const history = new Map();

  function getAllServers() {
    const visited = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const next of ns.scan(cur)) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return [...visited];
  }

  function getOrg(s) {
    try {
      const server = ns.getServer(s);
      return server.organizationName || "-";
    } catch {
      return "?";
    }
  }

  // Pad PLAIN text to a fixed visible width first — color codes must wrap
  // around the already-padded text, never be padded themselves, or columns
  // drift out of alignment (ANSI codes count toward .length but render as 0 width).
  function pad(str, len) {
    str = String(str);
    return str.length >= len ? str.slice(0, len - 1) + " " : str.padEnd(len);
  }

  function padNum(val, len) {
    const str = String(val);
    return str.length >= len ? str.slice(0, len) : str.padStart(len);
  }

  function colorize(text, color) {
    return color + text + RESET;
  }

  function fmtMoney(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + ns.format.number(Math.abs(n), "0.00a");
  }

  function moneyBar(pct) {
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(pct * BAR_WIDTH)));
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(BAR_WIDTH - filled);
    const barColor = pct >= 0.8 ? GREEN : pct >= 0.4 ? YELLOW : RED;
    return colorize(bar, barColor) + " " + padNum((pct * 100).toFixed(0) + "%", 4);
  }

  while (true) {
    ns.clearLog();

    const now = Date.now();
    const allServers = getAllServers();
    const myHackLevel = ns.getPlayer().skills.hacking;

    const rows = allServers
      .filter(s => s !== "home" && !s.startsWith("pserv-"))
      .map(s => {
        const money = ns.getServerMoneyAvailable(s);
        const maxMoney = ns.getServerMaxMoney(s);
        const pct = maxMoney > 0 ? money / maxMoney : 0;

        // ---- $/sec (EMA-smoothed) and pace tracking ----
        const prev = history.get(s);
        let rate = 0;
        let lowStreak = 0;
        if (prev) {
          const dt = (now - prev.time) / 1000;
          if (dt > 0) {
            const instRate = (money - prev.money) / dt;
            rate = prev.rate !== undefined
              ? RATE_SMOOTHING * instRate + (1 - RATE_SMOOTHING) * prev.rate
              : instRate;
          } else {
            rate = prev.rate || 0;
          }
          lowStreak = prev.lowStreak || 0;
        }
        const isLow = maxMoney > 0 && pct < LOW_BALANCE_THRESHOLD;
        lowStreak = isLow ? lowStreak + 1 : 0;
        history.set(s, { money, time: now, rate, lowStreak });

        return {
          name: s,
          rooted: ns.hasRootAccess(s),
          money, maxMoney, pct, rate, lowStreak,
          secNow: ns.getServerSecurityLevel(s),
          secMin: ns.getServerMinSecurityLevel(s),
          reqHack: ns.getServerRequiredHackingLevel(s),
          maxRam: ns.getServerMaxRam(s),
          org: getOrg(s),
        };
      })
      .sort((a, b) => b.maxMoney - a.maxMoney);

    const header =
      colorize(pad("SERVER", 18), WHITE) +
      colorize(pad("ROOT", 5), WHITE) +
      colorize(padNum("SEC", 6), WHITE) +
      colorize(padNum("MINSEC", 7), WHITE) +
      colorize(padNum("REQHACK", 8), WHITE) +
      colorize(padNum("RAM", 7), WHITE) +
      "  " + colorize(pad("FACTION/ORG", 16), WHITE) +
      "  " + colorize(pad("MONEY (of max)", BAR_WIDTH + 6), WHITE) +
      colorize(padNum("$/SEC", 12), WHITE) +
      "  " + colorize(pad("STATUS", 9), WHITE) +
      colorize("LOCKED?", WHITE);
    ns.print(header);
    ns.print(GRAY + "-".repeat(135) + RESET);

    for (const r of rows) {
      const locked = r.reqHack > myHackLevel;
      const isFaction = r.org !== "-" && r.org !== "?";

      const nameCell = colorize(pad(r.name, 18), isFaction ? CYAN : WHITE);
      const rootCell = r.rooted ? colorize(pad("YES", 5), GREEN) : colorize(pad("no", 5), GRAY);
      const secCell = padNum(r.secNow.toFixed(1), 6);
      const minSecCell = padNum(r.secMin.toFixed(1), 7);
      const reqHackCell = padNum(r.reqHack, 8);
      const ramCell = padNum(r.maxRam + "GB", 7);
      const orgCell = "  " + (isFaction ? colorize(pad(r.org, 16), MAGENTA) : colorize(pad(r.org, 16), GRAY));
      const barCell = "  " + moneyBar(r.pct);
      const rateColor = r.rate > 0 ? GREEN : r.rate < 0 ? RED : GRAY;
      const rateCell = colorize(padNum(fmtMoney(r.rate) + "/s", 12), rateColor);

      // Debug/pace indicator: a target sitting below the low-balance threshold for
      // several consecutive refreshes is falling behind its grow-back schedule.
      let statusCell = "";
      if (r.maxMoney > 0) {
        const delayed = r.lowStreak >= DELAYED_STREAK;
        statusCell = "  " + colorize(pad(delayed ? "DELAYED" : "ON PACE", 9), delayed ? RED : GREEN);
      } else {
        statusCell = "  " + pad("-", 9);
      }

      const lockedCell = locked ? colorize("LOCKED", RED) : "";

      ns.print(nameCell + rootCell + secCell + minSecCell + reqHackCell + ramCell + orgCell + barCell + rateCell + statusCell + lockedCell);
    }

    ns.print(GRAY + "-".repeat(135) + RESET);
    ns.print(
      `Hack level: ${myHackLevel} | Servers: ${rows.length} | ` +
      `Rooted: ${rows.filter(r => r.rooted).length} | ` +
      colorize("Faction-affiliated", MAGENTA) + ` | ` +
      colorize("ON PACE", GREEN) + `/` + colorize("DELAYED", RED) +
      ` = money staying above ${(LOW_BALANCE_THRESHOLD * 100).toFixed(0)}% of max | Refresh: ${REFRESH_INTERVAL / 1000}s`
    );

    await ns.sleep(REFRESH_INTERVAL);
  }
}
