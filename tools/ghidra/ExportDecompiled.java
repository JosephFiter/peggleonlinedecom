// Exports Ghidra's decompilation of every function, plus all defined strings
// with their cross-references, as plain text for grep-based analysis.
//
// Headless usage (see tools/ghidra/README.md):
//   analyzeHeadless <projDir> PeggleNights -import PeggleNights.exe \
//     -scriptPath tools/ghidra -postScript ExportDecompiled.java <outDir>
//
// Output (never commit it: it is derived from the game binary):
//   <outDir>/functions/<address>_<name>.c   one file per function
//   <outDir>/all.c                          everything concatenated
//   <outDir>/strings.tsv                    address, xref functions, string
//   <outDir>/floats.tsv                     float/double constants in data sections
//@category Export

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.TreeSet;

public class ExportDecompiled extends GhidraScript {

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args.length > 0 ? args[0] : "ghidra-export");
        File funcDir = new File(out, "functions");
        funcDir.mkdirs();

        exportStrings(new File(out, "strings.tsv"));
        exportFloats(new File(out, "floats.tsv"));

        DecompInterface decomp = new DecompInterface();
        DecompileOptions opts = new DecompileOptions();
        decomp.setOptions(opts);
        decomp.toggleCCode(true);
        decomp.toggleSyntaxTree(false);
        decomp.openProgram(currentProgram);

        int count = 0;
        int failed = 0;
        try (PrintWriter all = new PrintWriter(new File(out, "all.c"), StandardCharsets.UTF_8)) {
            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
            while (it.hasNext() && !monitor.isCancelled()) {
                Function f = it.next();
                if (f.isThunk() || f.isExternal()) continue;
                DecompileResults res = decomp.decompileFunction(f, 120, monitor);
                String header = "// " + f.getEntryPoint() + " " + f.getName(true) + "\n";
                String body;
                if (res != null && res.decompileCompleted()) {
                    body = res.getDecompiledFunction().getC();
                } else {
                    body = "// decompilation failed: " + (res == null ? "null" : res.getErrorMessage()) + "\n";
                    failed++;
                }
                String safe = f.getName().replaceAll("[^A-Za-z0-9_]", "_");
                if (safe.length() > 80) safe = safe.substring(0, 80);
                try (PrintWriter pw = new PrintWriter(
                        new File(funcDir, f.getEntryPoint().toString() + "_" + safe + ".c"), StandardCharsets.UTF_8)) {
                    pw.print(header);
                    pw.print(body);
                }
                all.print(header);
                all.print(body);
                all.print("\n");
                if (++count % 500 == 0) println("decompiled " + count + " functions");
            }
        } finally {
            decomp.dispose();
        }
        println("done: " + count + " functions, " + failed + " failed, output in " + out.getAbsolutePath());
    }

    private void exportStrings(File file) throws Exception {
        try (PrintWriter pw = new PrintWriter(file, StandardCharsets.UTF_8)) {
            pw.println("address\txref_functions\tstring");
            DataIterator it = currentProgram.getListing().getDefinedData(true);
            while (it.hasNext() && !monitor.isCancelled()) {
                Data d = it.next();
                if (!d.hasStringValue()) continue;
                String s = StringDataInstance.getStringDataInstance(d).getStringValue();
                if (s == null) continue;
                TreeSet<String> funcs = new TreeSet<>();
                for (Reference ref : getReferencesTo(d.getAddress())) {
                    Function f = getFunctionContaining(ref.getFromAddress());
                    funcs.add(f != null ? f.getName() + "@" + f.getEntryPoint() : ref.getFromAddress().toString());
                }
                pw.println(d.getAddress() + "\t" + String.join(",", funcs) + "\t"
                        + s.replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r"));
            }
        }
    }

    /** Every aligned 4-byte value in read-only/data sections that looks like a "nice" float. */
    private void exportFloats(File file) throws Exception {
        try (PrintWriter pw = new PrintWriter(file, StandardCharsets.UTF_8)) {
            pw.println("address\tfloat\tdouble_if_8\txrefs");
            for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
                if (b.isExecute() || !b.isInitialized()) continue;
                Address a = b.getStart();
                Address end = b.getEnd();
                while (a.compareTo(end) < 0 && !monitor.isCancelled()) {
                    try {
                        int bits = getInt(a);
                        float f = Float.intBitsToFloat(bits);
                        Reference[] refs = getReferencesTo(a);
                        if (refs.length > 0 && isPlausible(f)) {
                            String dbl = "";
                            try {
                                double dv = Double.longBitsToDouble(getLong(a));
                                if (isPlausible(dv)) dbl = Double.toString(dv);
                            } catch (Exception ignored) {
                            }
                            TreeSet<String> funcs = new TreeSet<>();
                            for (Reference ref : refs) {
                                Function fn = getFunctionContaining(ref.getFromAddress());
                                funcs.add(fn != null ? fn.getName() : ref.getFromAddress().toString());
                            }
                            pw.println(a + "\t" + f + "\t" + dbl + "\t" + String.join(",", funcs));
                        }
                    } catch (Exception ignored) {
                    }
                    a = a.add(4);
                }
            }
        }
    }

    private static boolean isPlausible(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return false;
        double av = Math.abs(v);
        return av == 0.0 || (av >= 1e-6 && av <= 1e7);
    }
}
