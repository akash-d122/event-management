#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Comprehensive test runner for Event Management API
 * Supports different test suites, coverage reporting, and CI/CD integration
 */

class TestRunner {
  constructor() {
    this.testSuites = {
      unit: 'tests/unit/',
      integration: 'tests/integration/',
      'edge-cases': 'tests/edge-cases/',
      concurrent: 'tests/concurrent/',
      all: 'tests/'
    };
    
    this.coverageDir = path.join(process.cwd(), 'coverage');
    this.reportsDir = path.join(this.coverageDir, 'reports');
  }

  /**
   * Parse command line arguments
   */
  parseArgs() {
    const args = process.argv.slice(2);
    const options = {
      suite: 'all',
      coverage: false,
      watch: false,
      ci: false,
      verbose: false,
      bail: false,
      parallel: false,
      updateSnapshot: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      switch (arg) {
        case '--suite':
        case '-s':
          options.suite = args[++i];
          break;
        case '--coverage':
        case '-c':
          options.coverage = true;
          break;
        case '--watch':
        case '-w':
          options.watch = true;
          break;
        case '--ci':
          options.ci = true;
          options.coverage = true;
          break;
        case '--verbose':
        case '-v':
          options.verbose = true;
          break;
        case '--bail':
        case '-b':
          options.bail = true;
          break;
        case '--parallel':
        case '-p':
          options.parallel = true;
          break;
        case '--update-snapshots':
        case '-u':
          options.updateSnapshot = true;
          break;
        case '--help':
        case '-h':
          this.showHelp();
          process.exit(0);
          break;
        default:
          if (arg.startsWith('--')) {
            console.warn(`Unknown option: ${arg}`);
          }
      }
    }

    return options;
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log(`
Event Management API Test Runner

Usage: node scripts/run-tests.js [options]

Options:
  -s, --suite <name>        Test suite to run (unit, integration, edge-cases, concurrent, all)
  -c, --coverage           Generate coverage report
  -w, --watch              Watch mode for development
  --ci                     CI mode (coverage + junit output)
  -v, --verbose            Verbose output
  -b, --bail               Stop on first test failure
  -p, --parallel           Run tests in parallel
  -u, --update-snapshots   Update Jest snapshots
  -h, --help               Show this help

Test Suites:
  unit                     Unit tests for individual components
  integration              Integration tests for complete workflows
  edge-cases               Edge cases and boundary value tests
  concurrent               Concurrent operation and race condition tests
  all                      All test suites

Examples:
  node scripts/run-tests.js --suite unit --coverage
  node scripts/run-tests.js --ci
  node scripts/run-tests.js --watch --suite integration
`);
  }

  /**
   * Validate test suite
   */
  validateSuite(suite) {
    if (!this.testSuites[suite]) {
      console.error(`❌ Invalid test suite: ${suite}`);
      console.error(`Available suites: ${Object.keys(this.testSuites).join(', ')}`);
      process.exit(1);
    }
  }

  /**
   * Setup test environment
   */
  setupEnvironment() {
    // Ensure coverage directories exist
    if (!fs.existsSync(this.coverageDir)) {
      fs.mkdirSync(this.coverageDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test-secret-key';
    }

    // Database configuration for tests
    if (!process.env.TEST_DB_HOST) {
      process.env.TEST_DB_HOST = 'localhost';
    }
    if (!process.env.TEST_DB_PORT) {
      process.env.TEST_DB_PORT = '5432';
    }
    if (!process.env.TEST_DB_USER) {
      process.env.TEST_DB_USER = 'postgres';
    }
    if (!process.env.TEST_DB_PASSWORD) {
      process.env.TEST_DB_PASSWORD = 'password';
    }
    if (!process.env.TEST_DB_NAME) {
      process.env.TEST_DB_NAME = 'event_management_test';
    }
  }

  /**
   * Build Jest command
   */
  buildJestCommand(options) {
    const jestArgs = [];

    // Test path
    if (options.suite !== 'all') {
      jestArgs.push(this.testSuites[options.suite]);
    }

    // Coverage
    if (options.coverage) {
      jestArgs.push('--coverage');
      jestArgs.push('--coverageReporters=text');
      jestArgs.push('--coverageReporters=lcov');
      jestArgs.push('--coverageReporters=html');
      jestArgs.push('--coverageReporters=json');
    }

    // Watch mode
    if (options.watch) {
      jestArgs.push('--watch');
    }

    // CI mode
    if (options.ci) {
      jestArgs.push('--ci');
      jestArgs.push('--watchAll=false');
      jestArgs.push('--testResultsProcessor=jest-junit');
    }

    // Verbose
    if (options.verbose) {
      jestArgs.push('--verbose');
    }

    // Bail on first failure
    if (options.bail) {
      jestArgs.push('--bail');
    }

    // Parallel execution
    if (options.parallel) {
      jestArgs.push('--maxWorkers=50%');
    } else {
      jestArgs.push('--maxWorkers=1'); // Serial for database tests
    }

    // Update snapshots
    if (options.updateSnapshot) {
      jestArgs.push('--updateSnapshot');
    }

    return jestArgs;
  }

  /**
   * Run Jest tests
   */
  async runJest(jestArgs) {
    return new Promise((resolve, reject) => {
      console.log(`🧪 Running Jest with args: ${jestArgs.join(' ')}`);
      
      const jest = spawn('npx', ['jest', ...jestArgs], {
        stdio: 'inherit',
        env: process.env
      });

      jest.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Jest exited with code ${code}`));
        }
      });

      jest.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Generate additional reports
   */
  async generateReports(options) {
    if (!options.coverage) return;

    console.log('📊 Generating additional coverage reports...');
    
    try {
      // Run coverage analysis
      const coverageSetup = require('../tests/coverage/coverageSetup');
      const results = coverageSetup.runCoverageAnalysis();
      
      if (results) {
        console.log(`✅ Coverage reports generated successfully`);
        console.log(`📄 HTML report: ${results.htmlPath}`);
        
        // Generate coverage summary for CI
        if (options.ci) {
          const summaryPath = path.join(this.coverageDir, 'coverage-summary.md');
          const summary = this.generateMarkdownSummary(results.summary);
          fs.writeFileSync(summaryPath, summary);
          console.log(`📝 Markdown summary: ${summaryPath}`);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not generate additional reports: ${error.message}`);
    }
  }

  /**
   * Generate markdown coverage summary
   */
  generateMarkdownSummary(summary) {
    if (!summary) return '# Coverage Report\n\nNo coverage data available.';

    const overall = summary.overall;
    
    return `# Test Coverage Report

## Overall Coverage
- **Statements:** ${overall.statements.pct.toFixed(1)}% (${overall.statements.covered}/${overall.statements.total})
- **Branches:** ${overall.branches.pct.toFixed(1)}% (${overall.branches.covered}/${overall.branches.total})
- **Functions:** ${overall.functions.pct.toFixed(1)}% (${overall.functions.covered}/${overall.functions.total})
- **Lines:** ${overall.lines.pct.toFixed(1)}% (${overall.lines.covered}/${overall.lines.total})

## Files with Lowest Coverage

| File | Statements | Branches | Functions | Lines |
|------|------------|----------|-----------|-------|
${summary.byFile.slice(0, 5).map(file => 
  `| ${file.file} | ${file.statements.pct.toFixed(1)}% | ${file.branches.pct.toFixed(1)}% | ${file.functions.pct.toFixed(1)}% | ${file.lines.pct.toFixed(1)}% |`
).join('\n')}

Generated: ${new Date().toLocaleString()}
`;
  }

  /**
   * Main execution function
   */
  async run() {
    console.log('🚀 Event Management API Test Runner');
    console.log('=====================================');

    const options = this.parseArgs();
    
    console.log(`📋 Test Suite: ${options.suite}`);
    console.log(`📊 Coverage: ${options.coverage ? 'enabled' : 'disabled'}`);
    console.log(`👀 Watch Mode: ${options.watch ? 'enabled' : 'disabled'}`);
    console.log(`🤖 CI Mode: ${options.ci ? 'enabled' : 'disabled'}`);

    this.validateSuite(options.suite);
    this.setupEnvironment();

    const jestArgs = this.buildJestCommand(options);

    try {
      await this.runJest(jestArgs);
      await this.generateReports(options);
      
      console.log('✅ Tests completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('❌ Tests failed:', error.message);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = TestRunner;
