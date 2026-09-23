import { CITIES, DIV } from "./corp-utils.js";

/** @param {NS} ns */
export async function main(ns) {
    const corp = ns.corporation;
    
    // Initial setup if corp doesn't exist
    try {
        corp.getCorporation();
    } catch (e) {
        ns.tprint("No corporation found. Run corp-setup.js first.");
        return;
    }
    
    ns.tprint("Corp orchestrator started.");
    
    // Main loop
    while (true) {
        try {
            // Check research progress and trigger actions
            const research = corp.getResearchTree(DIV.AGRICULTURE);
            const hasSmartSupply = corp.hasUnlockUpgrade("Smart Supply");
            const hasTA2 = corp.hasResearched(DIV.AGRICULTURE, "Market-TA.II");
            
            // Spawn staff script periodically (cheap, but not constantly)
            ns.run("corp-staff.js", 1, 6);
            
            // Buy materials if we have cash
            if (ns.getServerMoneyAvailable("home") > 1e9) {
                ns.run("corp-supply.js", 1, 500);
            }
            
            // Setup exports if Chemical division exists
            const corpInfo = corp.getCorporation();
            if (corpInfo.divisions.includes(DIV.CHEMICAL)) {
                ns.run("corp-export.js");
            }
            
            // Sell materials
            ns.run("corp-sell.js");
            
            // Log status
            const money = ns.getServerMoneyAvailable("home");
            ns.print(`Corp status: $${ns.format(money)} | TA2: ${hasTA2}`);
            
        } catch (e) {
            ns.print(`Error in loop: ${e}`);
        }
        
        // Wait 10 seconds before next cycle
        await ns.sleep(10000);
    }
}