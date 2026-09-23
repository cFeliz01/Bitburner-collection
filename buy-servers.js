/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Tune these to taste.
  const SPEND_FRACTION = 0.5;        // spend up to this fraction of spare cash per purchase
  const MONEY_RESERVE = 1_000_000;   // always keep at least this much cash on hand
  const PREFIX = "pserv-";
  const CHECK_INTERVAL = 10000;      // ms between checks
  const DRAIN_TIMEOUT = 120000;      // max ms to wait for a paused server to drain before upgrading anyway
  const PAUSE_FILE = "/data/paused-servers.txt";

  const MAX_RAM = ns.cloud.getRamLimit();
  const SERVER_LIMIT = ns.cloud.getServerLimit();

  function ownedServers() {
    return ns.cloud.getServerNames().filter(s => s.startsWith(PREFIX));
  }

  // Coordination with batch-worker.js: writing a hostname here tells any worker
  // to stop dispatching new threads to it, so we can safely upgrade without
  // killing in-flight batch actions.
  function readPaused() {
    const raw = ns.read(PAUSE_FILE);
    return raw ? JSON.parse(raw) : [];
  }

  function writePaused(list) {
    ns.write(PAUSE_FILE, JSON.stringify(list), "w");
  }

  function pauseServer(s) {
    const list = readPaused();
    if (!list.includes(s)) {
      list.push(s);
      writePaused(list);
    }
  }

  function unpauseServer(s) {
    writePaused(readPaused().filter(x => x !== s));
  }

  while (true) {
    const money = ns.getServerMoneyAvailable("home");
    const spendable = Math.max(money - MONEY_RESERVE, 0) * SPEND_FRACTION;
    const owned = ownedServers();

    if (owned.length < SERVER_LIMIT) {
      // Still buying our initial fleet. Grab the biggest RAM (power of 2) we can
      // currently afford, starting from a minimum of 8GB.
      let ram = 8;
      while (ram * 2 <= MAX_RAM && ns.cloud.getServerCost(ram * 2) <= spendable) {
        ram *= 2;
      }
      const cost = ns.cloud.getServerCost(ram);

      if (cost <= spendable) {
        const name = `${PREFIX}${owned.length}`;
        const hostname = ns.cloud.purchaseServer(name, ram);
        if (hostname) {
          ns.print(`Purchased ${hostname} with ${ram}GB RAM for ${ns.format.number(cost)}`);
        }
      }
    } else {
      // Fleet is at the cap — upgrade the smallest server first, doubling its RAM.
      // Upgrading force-kills every script running on that server, so we PAUSE it first
      // (batch-worker.js will stop sending it new work), wait for its current threads
      // to finish naturally, then upgrade, then unpause.
      const upgradeable = owned
        .map(s => ({ s, ram: ns.getServerMaxRam(s) }))
        .filter(o => o.ram < MAX_RAM)
        .sort((a, b) => a.ram - b.ram);

      for (const { s, ram } of upgradeable) {
        const newRam = ram * 2;
        const cost = ns.cloud.getServerUpgradeCost(s, newRam);

        if (cost <= spendable) {
          ns.print(`Pausing ${s} to drain before upgrade...`);
          pauseServer(s);

          const start = Date.now();
          while (ns.getServerUsedRam(s) > 0 && Date.now() - start < DRAIN_TIMEOUT) {
            await ns.sleep(1000);
          }
          if (ns.getServerUsedRam(s) > 0) {
            ns.print(`${s} didn't fully drain within ${DRAIN_TIMEOUT / 1000}s — upgrading anyway.`);
          }

          const ok = ns.cloud.upgradeServer(s, newRam);
          if (ok) {
            ns.print(`Upgraded ${s} from ${ram}GB to ${newRam}GB for ${ns.format.number(cost)}`);
          }
          unpauseServer(s);
          break; // one upgrade per cycle, re-evaluate fresh next loop
        }
      }
    }

    await ns.sleep(CHECK_INTERVAL);
  }
}
