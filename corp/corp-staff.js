import { CITIES, DIV, EMPLOYEE_ROLES, getJobAssignment } from "./corp-utils.js";

/** @param {NS} ns */
export async function main(ns) {
    const corp = ns.corporation;
    const targetEmployees = ns.args[0] || 6;
    
    for (const city of CITIES) {
        const office = corp.getOffice(DIV.AGRICULTURE, city);
        
        // Hire up to target
        let hiresNeeded = targetEmployees - office.numEmployees;
        for (let i = 0; i < hiresNeeded; i++) {
            corp.hireEmployee(DIV.AGRICULTURE, city);
        }
        
        // Get updated employee list
        const updatedOffice = corp.getOffice(DIV.AGRICULTURE, city);
        const employees = updatedOffice.employees;
        
        // Assign jobs evenly across roles
        const assignments = getJobAssignment(employees.length);
        let index = 0;
        
        for (const [role, count] of Object.entries(assignments)) {
            for (let i = 0; i < count && index < employees.length; i++) {
                corp.assignJob(DIV.AGRICULTURE, city, employees[index], role);
                index++;
            }
        }
    }
    
    ns.tprint(`Staffed ${CITIES.length} cities with ${targetEmployees} employees each.`);
}