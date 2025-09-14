declare module 'escomplex' {
  export interface ComplexityReport {
    complexity: {
      cyclomatic: number;
      halstead: {
        vocabulary: number;
        length: number;
        difficulty: number;
        volume: number;
        effort: number;
        bugs: number;
        time: number;
      };
      maintainability: number;
    };
    functions: Array<{
      name: string;
      complexity: {
        cyclomatic: number;
        halstead: any;
      };
    }>;
    dependencies: any[];
  }

  export function analyse(code: string): ComplexityReport;
}