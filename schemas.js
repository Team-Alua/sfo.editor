
module.exports = function() {
    const entries = {};
    const schemas = {
        entries,
    };

        
    function _writeEntryTobuffer(entry, data, buffer, start) {
        if (entry.type == 'raw') {
            for (let i = 0; i < entry.size; i++) {
                buffer[start + i] = data[i];
            }
        } else if (entry.type == "ascii" || entry.type == "utf8") {
            buffer.write(data, start, entry.size, entry.type);   
        } else if (entry.type === 'uint64') {
            buffer.writeBigUInt64LE(data, start);
        } else if (entry.type === 'uint32') {
            buffer.writeUInt32LE(data, start);
        } else if (entry.type === 'uint16') {
            buffer.writeUInt16LE(data, start);
        } else if (entry.type === 'int64') {
            buffer.writeBigInt64LE(data, start);
        } else if (entry.type === 'int32') {
            buffer.writeInt32LE(data, start);
        } else if (entry.type === 'int16') {
            buffer.writeInt16LE(data, start);
        } else if (entry.type === 'reference') {
            const refSchema = schemas.get(entry.objectName);
            const refBuffer = refSchema.toBuffer(data || {});
            for(let i = 0; i < refBuffer.length; i++) {
                buffer[start + i] = refBuffer[i];
            }
        } else if (entry.type === 'memoryAddress') {
            buffer.writeBigUInt64LE(data.start, start);
        } else {
            throw Error(`Don't know how to convert ${entry.type} to bytes!`);
        }
    }


    function _entryFromBuffer(entry, buffer, start, end) {
        if (entry.type == "raw") {
            return Array.from(buffer.subarray(start, end));
        } else if (entry.type == "ascii") {
            let nullIndex = Math.max(start, buffer.indexOf(0, start));
            end = Math.min(end, nullIndex);
            return buffer.toString(entry.type, start, end);   
        } else if (entry.type == "utf8") {
            // don't know how to handle this so defaulting to null terminated
            let nullTerminator = Math.max(start, buffer.indexOf(0, start));
            end = Math.min(end, nullTerminator);
            return buffer.toString(entry.type, start, end);
        } else if (entry.type === 'uint64' || entry.type === 'memoryAddress') { 
            return buffer.readBigUInt64LE(start);
        } else if (entry.type === 'uint32') { 
            return buffer.readUInt32LE(start);
        } else if (entry.type === 'uint16') { 
            return buffer.readUInt16LE(start);
        } else if (entry.type == 'int64') {
            return buffer.readBigInt64LE(start);
        } else if (entry.type == 'int32') {
            return buffer.readInt32LE(start);
        } else if (entry.type == 'int16') {
            return buffer.readInt16LE(start);
        } else if (entry.type == 'reference') {
            const refSchema = schemas.get(entry.objectName);
            return refSchema.fromBuffer(buffer.subarray(start, end));
        }
    }

    function Schema(schema) {
        const schemaHelper = {};
        schemaHelper.size = schema.size;
        schemaHelper.fromBuffer = function(buffer, start = 0) {
            const bufferSize = buffer.length - start;
            if (bufferSize < schema.size) {
                throw Error('Buffer length is less than ' + schema.size);
            }
            
            const obj = {};

            for (const entry of schema.requirements) {
                start = entry.offset || start;
                const end = start + entry.size;
                obj[entry.name] = _entryFromBuffer(entry, buffer, start, end);
                start += entry.size;
            }
            return obj;
        }

        schemaHelper.toBuffer = function(dataSet, defaultBuffer = null, start = 0, end = 0) {
            let buffer = defaultBuffer;
            if (!defaultBuffer) {
                buffer = Buffer.alloc(schema.size);
            }

            for (const entry of schema.requirements) {
                start = entry.offset || start;
                end = start + entry.size;
                let data = dataSet[entry.name] || entry.dv;
                _writeEntryTobuffer(entry, data, buffer, start);
                start += entry.size;
            }
            return buffer;
        }

        return schemaHelper;
    }

    function getTypeByteSize(typeName, defaultSize = 0) {
        const typeToBytes = {
            'char': 1,
            'int': 4,
            'uint16': 2,
            'uint32': 4,
            'uint64': 8,
            'int16': 2,
            'int32': 4,
            'int64': 8,
            'memoryAddress': 8, // same as uint64
        }
        return typeToBytes[typeName] || defaultSize;
    }

    function getDefaultValue(typeName, dv) {
        const typeToDv = {
            'char': 0,
            'int': 0,
            'uint16': 0,
            'uint32': 0,
            'uint64': 0n,
            'int16': 0,
            'int32': 0,
            'int64': 0n,
            'memoryAddress': 0n,
            'utf8': '\x00',
            'ascii': '\x00',
        };

        if (dv == null) {
            dv = typeToDv[typeName];
        }
        return dv;
    }

    /* [{
        name: string,
        type: "raw" | "ascii" | "utf8" | "int",
        dv: 0, // default value
        size: int // in bytes
    }] */
    schemas.create = function(schemaName, requirements, defaultBufferSize = 0) {
        if (entries[schemaName]) {
            return entries[schemaName];
        }

        const newEntry = {
            size: 0,
            requirements: []
        };
        let totalSize = 0;
        for (const requirement of requirements) {
            const {name, type, size, dv, offset, objectName} = requirement;
            const entry = {};
            entry.name = name;
            entry.type = type;
            entry.offset = offset;
            entry.dv = getDefaultValue(type, dv);
            entry.size = getTypeByteSize(type, size);

            if (requirement.type === "reference") {
                if (!entries[objectName]) {
                    throw Error(`Schema ${objectName} does not exist!`);
                }
                entry.objectName = objectName;
                entry.size = entries[objectName].size;
            }

            if (!isNaN(offset)) {
                totalSize = offset + entry.size;
            } else {
                totalSize += entry.size;
            }
            newEntry.requirements.push(entry);
        }
        newEntry.size = Math.max(defaultBufferSize, totalSize);
        entries[schemaName] = Schema(newEntry);
        return entries[schemaName];
    };

    schemas.get = function(name) {
        return entries[name];
    };
    
    schemas.writeEntryToBuffer = _writeEntryTobuffer;
    schemas.readEntryFromBuffer = _entryFromBuffer;
    
    return schemas;
}