import { readFile } from "fs/promises";

interface DependencyInfo {
  name: string;
  version: string;
  type: "runtime" | "dev";
  size?: number;
  usage: string[];
  alternatives?: Alternative[];
}

interface Alternative {
  name: string;
  size: number;
  pros: string[];
  cons: string[];
}

// Lightweight alternatives to heavy dependencies
export const LIGHTWEIGHT_ALTERNATIVES: Record<string, Alternative[]> = {
  inquirer: [
    {
      name: "prompts",
      size: 18000, // ~18KB vs inquirer's ~500KB+
      pros: ["Much smaller", "Lightweight", "Promise-based"],
      cons: ["Fewer features", "Different API"],
    },
  ],
  chalk: [
    {
      name: "kleur",
      size: 2000, // ~2KB vs chalk's ~15KB
      pros: ["Tiny size", "Fast", "Same API"],
      cons: ["No TypeScript support", "Fewer features"],
    },
    {
      name: "picocolors",
      size: 1500, // ~1.5KB
      pros: ["Smallest", "Fast", "Good TypeScript support"],
      cons: ["Different API"],
    },
  ],
  ora: [
    {
      name: "cli-spinners",
      size: 8000, // ~8KB vs ora's ~50KB+
      pros: ["Much smaller", "Just spinners"],
      cons: ["Manual implementation needed"],
    },
  ],
  "ts-pattern": [
    {
      name: "native-switch",
      size: 0, // Native JavaScript
      pros: ["No dependency", "Fast"],
      cons: ["Less type safety", "More verbose"],
    },
  ],
};

/**
 * Analyze current dependencies and suggest optimizations
 */
export class DependencyAnalyzer {
  private dependencies: DependencyInfo[] = [];

  async analyzeDependencies(packageJsonPath: string): Promise<{
    current: DependencyInfo[];
    optimizations: Array<{
      current: string;
      suggested: Alternative;
      potentialSavings: number;
    }>;
    totalPotentialSavings: number;
  }> {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    // Analyze runtime dependencies
    this.dependencies = Object.entries(packageJson.dependencies || {}).map(
      ([name, version]) => ({
        name,
        version: version as string,
        type: "runtime" as const,
        usage: this.analyzeUsage(name),
        alternatives: LIGHTWEIGHT_ALTERNATIVES[name],
      })
    );

    const optimizations = this.dependencies
      .filter(dep => dep.alternatives && dep.alternatives.length > 0)
      .map(dep => {
        const bestAlternative = dep.alternatives?.[0];
        if (!bestAlternative) return null;
        return {
          current: dep.name,
          suggested: bestAlternative,
          potentialSavings: this.estimateSavings(dep.name, bestAlternative),
        };
      })
      .filter((opt): opt is NonNullable<typeof opt> => opt !== null)
      .filter(opt => opt.potentialSavings > 0);

    const totalPotentialSavings = optimizations.reduce(
      (sum, opt) => sum + opt.potentialSavings,
      0
    );

    return {
      current: this.dependencies,
      optimizations,
      totalPotentialSavings,
    };
  }

  private analyzeUsage(dependencyName: string): string[] {
    // Static analysis of usage patterns (simplified)
    const usagePatterns: Record<string, string[]> = {
      inquirer: ["Interactive prompts", "Config setup", "User input"],
      chalk: ["Console coloring", "Error messages", "Success messages"],
      ora: ["Loading spinners", "Progress indicators"],
      "ts-pattern": ["Pattern matching", "Type-safe switches"],
      "type-fest": ["Utility types", "Type helpers"],
      "@google/genai": ["AI API calls", "Core functionality"],
      commander: ["CLI parsing", "Command structure"],
      "simple-git": ["Git operations", "Repository management"],
      zod: ["Schema validation", "Type safety"],
    };

    return usagePatterns[dependencyName] ?? ["Unknown usage"];
  }

  private estimateSavings(
    currentDep: string,
    alternative: Alternative
  ): number {
    const currentSizes: Record<string, number> = {
      inquirer: 500000, // ~500KB
      chalk: 15000, // ~15KB
      ora: 50000, // ~50KB
      "ts-pattern": 25000, // ~25KB
      "type-fest": 10000, // ~10KB
    };

    const currentSize = currentSizes[currentDep] ?? 0;
    return Math.max(0, currentSize - alternative.size);
  }

  /**
   * Generate optimization report
   */
  generateReport(
    analysis: Awaited<ReturnType<typeof this.analyzeDependencies>>
  ): string {
    let report = "# Dependency Analysis Report\n\n";

    report += "## Current Dependencies\n";
    analysis.current.forEach(dep => {
      report += `- **${dep.name}** (${dep.version})\n`;
      report += `  - Usage: ${dep.usage.join(", ")}\n`;
      if (dep.alternatives) {
        report += `  - Alternatives available: ${dep.alternatives.length}\n`;
      }
      report += "\n";
    });

    report += "## Optimization Opportunities\n\n";

    if (analysis.optimizations.length === 0) {
      report += "No significant optimization opportunities found.\n";
    } else {
      analysis.optimizations.forEach(opt => {
        report += `### Replace ${opt.current} with ${opt.suggested.name}\n`;
        report += `- **Size reduction**: ${(opt.potentialSavings / 1000).toFixed(1)}KB\n`;
        report += `- **Pros**: ${opt.suggested.pros.join(", ")}\n`;
        report += `- **Cons**: ${opt.suggested.cons.join(", ")}\n`;
        report += "\n";
      });

      report += `## Total Potential Savings: ${(analysis.totalPotentialSavings / 1000).toFixed(1)}KB\n`;
    }

    return report;
  }
}
