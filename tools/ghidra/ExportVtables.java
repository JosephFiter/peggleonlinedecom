// Dumps every RTTI-named vftable as a list of (offset, function) entries.
//
//   analyzeHeadless <projDir> PeggleNights -process PeggleNights.inner.exe -noanalysis -readOnly \
//     -scriptPath tools/ghidra -postScript ExportVtables.java <outFile>
//
// Output: one block per class (derived from the game binary; never commit it).
//@category Export

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;

import java.io.File;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

public class ExportVtables extends GhidraScript {

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args.length > 0 ? args[0] : "vtables.txt");
        out.getParentFile().mkdirs();
        try (PrintWriter pw = new PrintWriter(out, StandardCharsets.UTF_8)) {
            SymbolIterator it = currentProgram.getSymbolTable().getAllSymbols(true);
            while (it.hasNext() && !monitor.isCancelled()) {
                Symbol s = it.next();
                if (!s.getName().equals("vftable")) continue;
                String cls = s.getParentNamespace().getName(true);
                pw.println("== " + cls + " @ " + s.getAddress());
                Address a = s.getAddress();
                for (int i = 0; i < 256; i++) {
                    Address entry = a.add(i * 4L);
                    if (i > 0 && currentProgram.getSymbolTable().getPrimarySymbol(entry) != null
                            && currentProgram.getSymbolTable().getPrimarySymbol(entry).getName().equals("vftable")) {
                        break;
                    }
                    long ptr = getInt(entry) & 0xffffffffL;
                    Address target = toAddr(ptr);
                    Function f = getFunctionAt(target);
                    if (f == null) {
                        if (currentProgram.getMemory().getBlock(target) == null
                                || !currentProgram.getMemory().getBlock(target).isExecute()) {
                            break;
                        }
                        pw.println(String.format("  +0x%02x  %s  (no function)", i * 4, target));
                    } else {
                        pw.println(String.format("  +0x%02x  %s  %s", i * 4, target, f.getName()));
                    }
                }
            }
        }
        println("wrote " + out.getAbsolutePath());
    }
}
