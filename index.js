const fs = require('fs');
const _ = require('lodash');
const { resolve } = require('path');
const { promisify } = require('util');
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const config = require('./config.js');
const { filetypes, styles, filtered } = require('./config.js');
const stylesheetFiles = new RegExp('\.('+ filetypes.join('|') + ')$');
const colors = new RegExp('(' + styles.join('|') + '):.+;', 'gi');
const blockedStyles = new RegExp(filtered.join('|'), 'gi');
const shortPath = new RegExp(__dirname + '(.+)');
const path = process.argv[2] || __dirname;


async function getFiles(dir) {
  const subdirs = await readdir(dir);
  const files = await Promise.all(subdirs.map(async (subdir) => {
    const res = resolve(dir, subdir);
    return (await stat(res)).isDirectory() ? getFiles(res) : res;
  }));
  return files
  	.reduce((a, f) => a.concat(f), [])
  	.filter(f => f.match(stylesheetFiles));
}

const transformStyles = (styles) => (
	styles
		.split('\n')
		.map((line, i) => {
			const matches = line.match(colors); 

			if (matches) {
				return [...matches].map(match => {
					const [name, value] = match.split(':');

					return { 
						name, 
						value: value.toLowerCase(), 
						line: i + 1 
					};
				});
			} 
		})
		.reduce((a, b) => a.concat(b), [])
		.filter(match => match)
);

const getSameColorValues = valuesArray => {
	const result = {};

	const checkIfNotBlockedValue = value => !(new RegExp(blockedStyles)).test(value);

	const buildOutputObject = (filename, name, value, line) => {
		const shortFilenamePath = filename.match(shortPath)[1];

		return {
			filename: shortFilenamePath,
			style: [name, value].join(':').trim(),
			line,
		};
	};

	const getResult = (valuesArray, result) => {
		const firstMatch = valuesArray[0].matches.shift();
		const { filename } = valuesArray[0];
		const { name, value, line } = firstMatch;

		valuesArray.forEach(({ filename: _filename, matches: _matches }) => {
			_matches.filter(({ name: _name, value: _value, line: _line }) => {
				if (value === _value && checkIfNotBlockedValue(value)) {
					const ethalon = buildOutputObject(filename, name, value, line);
					const matchedToEthalon = buildOutputObject(_filename, _name, _value, _line);
					
					if (!result[value]) {
						result[value] = {};
						result[value].found = [];
						result[value].found.push(ethalon);
					} 

					const isAlreadyExists = _.find(result[value].found, matchedToEthalon);

					if (!isAlreadyExists) {
						result[value].found.push(matchedToEthalon);
					}

					return true;
				}
				return false;
			});
		});

		if (!valuesArray[0].matches.length) {
			valuesArray.shift();
		}

		if (valuesArray.length) {
			getResult(valuesArray, result);
		}
	};

	getResult(valuesArray, result);

	return result;
};

const saveToHTML = (data = {}, filename) => {
	const html = [];
	const colorRegExp = /(#|rgb|hsl).+[^;]/gi;

	Object.keys(data).forEach(key => {
		const { found } = data[key];

		html.push('<h3>' + key + '</h3>');
		found.forEach(({ style: styleName, filename, line }) => {
			const colorValue = styleName.match(colorRegExp);
			const style = 'background: ' + colorValue + ';';

			html.push('<div>filename: ' + filename + '</div>');
			html.push('<div style="display: inline-block; ' + style + '">');
			html.push('style: ' + styleName + '</div>');
			html.push('<div>line: ' + line + '</div>');
			html.push('<br />');
		});
	});
	const htmlAsString = html.join('\n');

	return writeFile(filename, htmlAsString);
};

const extractStyles = async (filenames) => {
	const result = await Promise.all([].concat(filenames)
		.map(async (filename, i) => {
			const styles = await readFile(filename, 'utf8');
			const matches = transformStyles(styles);

			return { filename, matches };
		}));

	return result.filter(({ matches }) => matches.length !== 0);
};

(async () => {
	const files = await getFiles(path).catch(e => { throw e });
	const extractedStyles = await extractStyles(files).catch(e => { throw e });
	const sameColorValues = getSameColorValues(extractedStyles);
	await saveToHTML(sameColorValues, 'output2.html').catch(e => { throw e });
	  
	console.log('Done');
})();
