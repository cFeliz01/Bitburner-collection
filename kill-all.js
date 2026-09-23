/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

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

  const servers = getAllServers();
  let killedServers = 0;

  // Kill everywhere else first, home last, so this script itself doesn't get
  // cut off mid-loop before it's had a chance to clear every other host.
  for (const s of servers) {
    if (s === "home") continue;
    const running = ns.ps(s);
    if (running.length > 0) {
      ns.killall(s);
      killedServers++;
      ns.tprint(`Killed ${running.length} script(s) on ${s}`);
    }
  }

  // Kill everything on home except this script itself.
  const homeRunning = ns.ps("home").filter(p => p.filename !== ns.getScriptName() || p.pid !== ns.pid);
  if (homeRunning.length > 0) {
    for (const p of homeRunning) {
      ns.kill(p.pid);
    }
    killedServers++;
    ns.tprint(`Killed ${homeRunning.length} script(s) on home`);
  }

  ns.tprint(`Done. Cleared scripts on ${killedServers} server(s).`);
}
