// Dumps the disassembly of the given functions (by entry address) to text.
// Useful where the decompiler loses register-passed arguments.
//
//   analyzeHeadless <projDir> PeggleNights -process PeggleNights.inner.exe -noanalysis \
//     -scriptPath tools/ghidra -postScript ExportAsm.java <outDir> 00492cd0 004928c0 ...
//
// Output: <outDir>/<address>.asm (derived from the game binary; never commit it).
//@category Export

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

public class ExportAsm extends GhidraScript {

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) {
            printerr("usage: ExportAsm.java <outDir> <address> [<address> ...]");
            return;
        }
        File out = new File(args[0]);
        out.mkdirs();
        for (int i = 1; i < args.length; i++) {
            Address addr = toAddr(args[i]);
            Function f = getFunctionAt(addr);
            if (f == null) {
                printerr("no function at " + args[i]);
                continue;
            }
            try (PrintWriter pw = new PrintWriter(new File(out, args[i] + ".asm"), StandardCharsets.UTF_8)) {
                pw.println("; " + f.getName() + " @ " + f.getEntryPoint());
                InstructionIterator it = currentProgram.getListing().getInstructions(f.getBody(), true);
                while (it.hasNext()) {
                    Instruction ins = it.next();
                    StringBuilder line = new StringBuilder();
                    line.append(ins.getAddress()).append("  ").append(ins);
                    // Annotate float constants loaded from memory with their value.
                    for (Reference ref : ins.getReferencesFrom()) {
                        Address to = ref.getToAddress();
                        if (!to.isMemoryAddress()) continue;
                        try {
                            String mnem = ins.getMnemonicString().toUpperCase();
                            if (mnem.startsWith("F")) {
                                String rep = ins.toString().toUpperCase();
                                if (rep.contains("QWORD") || rep.contains("DOUBLE PTR")) {
                                    line.append("    ; double ").append(Double.longBitsToDouble(getLong(to)));
                                } else if (rep.contains("DWORD") || rep.contains("FLOAT PTR")) {
                                    line.append("    ; float ").append(Float.intBitsToFloat(getInt(to)))
                                        .append(" (0x").append(Integer.toHexString(getInt(to))).append(")");
                                }
                            }
                        } catch (Exception ignored) {
                        }
                        Function callee = getFunctionAt(to);
                        if (callee != null && ins.getFlowType().isCall()) {
                            line.append("    ; -> ").append(callee.getName());
                        }
                    }
                    pw.println(line);
                }
            }
            println("wrote " + args[i]);
        }
    }
}
