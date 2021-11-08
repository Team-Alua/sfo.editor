const fs = require('fs');
const SFOEditor = require('./sfo.editor.js')();
const { Command } = require('commander');
const program = new Command();
program.version('1.0.0');


program
  .requiredOption('-s, --sfo <string>', 'Path to sfo file')
  .requiredOption('-c, --config <string>', 'Path to config file')
  .requiredOption('-o, --output <string>', 'Output path')
  .parse();

const options = program.opts();


SFOEditor.load(options.sfo);

const configFile = JSON.parse(fs.readFileSync(options.config, 'utf8'));

for (const sfoKey of Object.keys(configFile)) {
    SFOEditor.editEntry(sfoKey, configFile[sfoKey]);
}

fs.writeFileSync(options.output, SFOEditor.export());