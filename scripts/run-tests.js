async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  const cases = [
    { name: "generate-index", mod: "../tests/generate-index.test.js" },
    { name: "dev-server-auth", mod: "../tests/dev-server-auth.test.js" }
  ];

  for (const item of cases) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const m = require(item.mod);
    await runCase(item.name, m.run);
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
