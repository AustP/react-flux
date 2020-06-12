module.exports = {
  // Indicates whether the coverage information should be collected while executing the test.
  collectCoverage: true,

  // A list of reporter names that Jest uses when writing coverage reports.
  coverageReporters: ['text'],

  // A preset that is used as a base for Jest's configuration.
  preset: 'ts-jest',

  // The test environment that will be used for testing.
  testEnvironment: 'jsdom',

  // The glob patterns Jest uses to detect test files.
  testMatch: ['<rootDir>/tests/*.*'],
};
