/**
 * VibeOS Core Bootstrap
 * Entry point for initializing the VibeOS infrastructure
 */

import { CommandDispatcher } from './core/dispatcher.js';
import { Shield } from './security/shield.js';
import { TerminalInterface } from './api/terminal.js';

async function bootstrap() {
    console.clear();
    console.log("\x1b[36m%s\x1b[0m", `
    __     ___ _            ____  ____  
    \\ \\   / (_) |__   ___  / __ \\/ ___| 
     \\ \\ / /| | '_ \\ / _ \\| |  | \\___ \\ 
      \\ V / | | |_) |  __/| |__| |___) |
       \\_/  |_|_.__/ \\___| \\____/|____/ 
    `);
    console.log("\x1b[32m%s\x1b[0m", " > System: VibeOS v0.9");
    console.log("\x1b[32m%s\x1b[0m", " > Identity: ARCHIT3CT3");
    console.log("\x1b[90m%s\x1b[0m", " ---------------------------------------");

    const shield = new Shield();
    const dispatcher = new CommandDispatcher();
    dispatcher.registerHook(shield);
    await dispatcher.initialize();

    console.log(" [!] Security Shield: ACTIVE");
    console.log(" [!] Dispatcher: INITIALIZED");

    // Start interactive terminal
    const terminal = new TerminalInterface();
    await terminal.start(dispatcher);
}

bootstrap().catch(err => {
    console.error("Critical System Failure:", err);
    process.exit(1);
});
