const fs = require('fs');
const schemas = require('./schemas.js')();

const sfoHeaderSchema = schemas.create('SFOHeader', [{
    name: "magic",
    type: "raw",
    size: 4
},{
    name: "version",
    type: "raw",
    size: 4
}, {
    name: "keyTableOffset",
    type: "int32"
}, {
    name: "dataTableOffset",
    type: "int32"
}, {
    name: "entryCount",
    type: "int32"
}]);

const indexTableEntrySchema = schemas.create('IndexTableEntry', [{
    name: "keyOffset",
    type: "uint16"
}, {
    name: "paramFormat", 
    type: "uint16"
}, {
    name: "paramLength",
    type: "uint32"
}, {
    name: "paramMaxLength",
    type: "uint32"
}, {
    name: "dataOffset",
    type: "uint32"
}]);

const paramTypes = {
    "ACCOUNT_ID": "uint64",
    "SAVEDATA_BLOCKS": "uint64",
};
module.exports = function() {
    const sfoEditor = {};
    let sfoData = {};

    sfoEditor.load = function(sfoFilePath) {
        const sfoBuffer = fs.readFileSync(sfoFilePath);
        return sfoEditor.loadFromBuffer(sfoBuffer);
    };

    sfoEditor.show = function() {
        console.log(sfoData);
    };

    sfoEditor.loadFromBuffer = function(sfoBuffer) {
        sfoData = {};
        const sfoHeader = sfoHeaderSchema.fromBuffer(sfoBuffer);
        sfoData.header = sfoHeader;


        const sfoIndex = [];
        const entries = new Map;
        sfoData.index = sfoIndex;
        sfoData.entries = entries;
        sfoData.entryIndexMapping = {};
        
        let indexTableOffset = sfoHeaderSchema.size;
        for (let i = 0; i < sfoHeader.entryCount; i++) {
            const offset = indexTableOffset + (i * indexTableEntrySchema.size);
            const indexEntry = indexTableEntrySchema.fromBuffer(sfoBuffer, offset);
            sfoIndex.push(indexEntry);
            const keyOffset = sfoHeader.keyTableOffset + indexEntry.keyOffset;
            const dataOffset = sfoHeader.dataTableOffset + indexEntry.dataOffset;
            const key = schemas.readEntryFromBuffer({
                type: "utf8",
            }, sfoBuffer, keyOffset, Number.MAX_VALUE);
            sfoData.entryIndexMapping[key] = i;
            let value = undefined;
            if (indexEntry.paramFormat === 0x4) {
                value = schemas.readEntryFromBuffer({
                    type: paramTypes[key] || "raw",
                }, sfoBuffer, dataOffset, dataOffset + indexEntry.paramLength);
            } else if (indexEntry.paramFormat === 0x204) {
                value = schemas.readEntryFromBuffer({
                    type: "utf8",
                }, sfoBuffer, dataOffset, dataOffset + indexEntry.paramMaxLength);
            } else if (indexEntry.paramFormat === 0x404) {
                value = schemas.readEntryFromBuffer({
                    type: "uint32",
                }, sfoBuffer, dataOffset, dataOffset + indexEntry.paramMaxLength);
            }
            entries.set(key, value);
        }
    }

    sfoEditor.editEntry = function(key, value) {
        const entryIndex = sfoData.entryIndexMapping[key];
        if (entryIndex == null) {
            throw Error(`No entry for ${key}`);
        }
        const index = sfoData.index[entryIndex];
        let indexType;
        if (index.paramFormat === 0x4) {
            indexType = paramTypes[key] || "raw";
        } else if (index.paramFormat === 0x204) {
            indexType = "utf8";
        } else if (index.paramFormat === 0x404) {
            indexType = "uint32";
        }

        if (indexType === "uint32") {
            if (isNaN(value)) {
                throw Error(`[${key}] value must be a number!`);
            }
            if (typeof value === "bigint") {
                throw Error(`[${key}] value can not be a bigint!`);
            }
            if (value < 0 || 0xFFFFFFFF < value) {
                throw Error(`[${key}] Value must be at least 0 and at most 4294967295!`);
            }
        } else if (indexType === "utf8") {
            if (typeof value !== "string") {
                throw Error(`[${key}] value must be a string!`);
            }
            const maxStringLength = index.paramMaxLength - 1;
            if (value.length > maxStringLength) {
                throw Error(`[${key}] string length must be at most ${maxStringLength}`);
            }
        } else if (indexType === "uint64") {
            if (!isNaN(value)) {
                value = BigInt(value);
            }
            
            if (typeof value !== "bigint") {
                throw Error(`[${key}] value must be a bigint!`);
            }
            const maxValue = 2n**64n;
            if (value < 0n || maxValue < value) {
                throw Error(`[${key}] value must be at least 0 and at most ${maxValue.toString()}!`);
            }
        } else if (indexType === "raw") {
            if (!Array.isArray(value)) {
                throw Error(`[${key}] value must be an array!`);
            }
            if (value.length !== index.paramMaxLength) {
                throw Error(`[${key}] value must have ${index.paramMaxLength} elements!`);
            }
            let isCorrectType = true;
            for (const item of value)  {
                if (typeof item !== "number") {
                    isCorrectType = false;
                    break;
                }
                if (item < 0 || 255 < item) {
                    isCorrectType = false;
                    break;
                }
            }
            if (!isCorrectType) {
                throw Error(`[${key}] all elements must be a number that is at least 0 and at most 255!`);
            }
        }
        sfoData.entries.set(key, value);
        if (indexType === 'utf8') {
            index.paramLength = value.length + 1;
        }
    }

    function alignByFour(value) {
        if (value%4) {
            return value + (4 - (value%4));
        }
        return value;
    }

    sfoEditor.export = function() {
        const offsets = {};
        
        offsets.header = 0;
        const headerSize = 0x14;
        let size = headerSize;
        
        offsets.indexTable = size;
        const indexTableEntrySize = 0x10;
        const entryCount = sfoData.header.entryCount;
        size += indexTableEntrySize * entryCount;
        
        offsets.keyTable = size;
        let keyTableSize = Array.from(sfoData.entries.keys())
                                .reduce((size, key) => size + (key.length + 1), 0);
        keyTableSize = alignByFour(keyTableSize);
        size += keyTableSize;
        
        offsets.dataTable = size;
        const dataTableSize = sfoData.index.reduce((size, index) => size + index.paramMaxLength, 0);
        size += dataTableSize;
        const buffer = Buffer.alloc(size);

        // update these just in case they changed
        sfoData.header.keyTableOffset = offsets.keyTable;
        sfoData.header.dataTableOffset = offsets.dataTable;

        sfoHeaderSchema.toBuffer(sfoData.header, buffer);

        // sort alphabetically
        const entryKeys = Array.from(sfoData.entries.keys()).sort();


        let indexOffset = offsets.indexTable;
        let keyOffset = 0;
        let dataOffset = 0;
        for (let i = 0; i < entryKeys.length; i++) {
            const entryKey = entryKeys[i];
            const entryValue = sfoData.entries.get(entryKey);
            const entrySFOIndex = sfoData.entryIndexMapping[entryKey];
            const sfoIndex = sfoData.index[entrySFOIndex]; 
            
            // relative to the base
            sfoIndex.keyOffset = keyOffset;
            sfoIndex.dataOffset = dataOffset;
            
            // write index to buffer
            indexTableEntrySchema.toBuffer(sfoIndex, buffer, indexOffset);

            // write key to buffer
            schemas.writeEntryToBuffer({
                type: "utf8",
            }, entryKey, buffer, offsets.keyTable + keyOffset);

            // write value to buffer
            if (sfoIndex.paramFormat === 0x4) {
                const entryObj = {
                    type: paramTypes[entryKey] || "raw",
                };
                if (entryObj.type === 'raw') {
                    entryObj.size = entryValue.length;
                }
                schemas.writeEntryToBuffer(entryObj, entryValue, buffer, offsets.dataTable + dataOffset);
            } else if (sfoIndex.paramFormat === 0x204) {
                schemas.writeEntryToBuffer({
                    type: "utf8",
                }, entryValue, buffer, offsets.dataTable + dataOffset);
            } else if (sfoIndex.paramFormat === 0x404) {
                schemas.writeEntryToBuffer({
                    type: "uint32",
                }, entryValue, buffer, offsets.dataTable + dataOffset);
            }

            keyOffset += entryKey.length + 1;
            dataOffset += sfoIndex.paramMaxLength;
            indexOffset += indexTableEntrySize;
        }
        return buffer;
    }
    // keyTable = 212
    // dataTable = 348
    return sfoEditor;
}