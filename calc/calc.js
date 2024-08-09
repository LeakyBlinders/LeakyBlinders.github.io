let terminals;

let layoutConfig = {
    "content": [{
        "type": "row",
        "content": [{
            "type": "column",
            "content": [{
                type: 'component',
                componentName: 'term',
                componentState: {id: 'calc'},
                title:"Calculator"
            }, {
                type: 'component',
                componentName: 'helpDocumentComponent',
                title: 'Help'
                }
            ]
        }, {
            "type": "column",
            "content": [{
                type: 'component',
                componentName: 'term',
                componentState: {id: 'memory'},
                title:"Memory"
            }, {
                type: 'component',
                componentName: 'term',
                title:"Previous Values",
                componentState: {id: 'previous'}
            }]
        }]
    }]
};

let myLayout = new GoldenLayout( layoutConfig );

myLayout.registerComponent( 'term', function( container, componentState ){
    let html = `<div id="${componentState.id}-wrapper" class="cwrapper">`;
    html += `<div id="${componentState.id}-parent" class="cparent"><div id="${componentState.id}" class="xt"></div></div>`;
    if (componentState.id=='calc')
        html+="<div id='inputDiv'><div id='mode'>dec:</div><input type='text' id='readline' placeholder='enter calculation' autocomplete=\"off\"></div>";
    html += "</div>";
    container.getElement().html( html );

    console.log(container);
    container.on('resize',function() {
       terminals[componentState.id].fitAddon.fit();
    });

    setTimeout(()=>{
        let el = document.getElementById(componentState.id);
        terminals[componentState.id].term.open(el);
        terminals[componentState.id].fitAddon.fit();
        $('#readline').focus();
    },50);

});

myLayout.registerComponent('helpDocumentComponent', function(container) {
    // Get the help document element from the original HTML
    let helpDoc = document.getElementById('help-document').cloneNode(true);
    helpDoc.style.display = 'block'; // Make it visible
    container.getElement().append(helpDoc);
});

let otherHalfLoaded=false;
document.fonts.ready.then( (ffs)=> {
    console.log(ffs);
    if (otherHalfLoaded) {
        window.setTimeout(init,10);
    } else
        otherHalfLoaded=true;
});

window.onload = () => {
    console.log("onload");
    if (otherHalfLoaded) {
        window.setTimeout(init,10);
    } else
        otherHalfLoaded=true;
};

function init() {
    console.log("init");
    $('#preload').toggle(false);
    terminals = {
        calc: {
            term: new Terminal({
                cursorBlink: true,
                theme: {
                    background: '#0000ff',
                    foreground: '#ffffff',
                },
                fontFamily: 'Noto Sans Mono',
                fontSize:13,
                lineHeight:1.1,
                enableBold:true,
                fontWeightBold:700,
            })
        },
        memory: {
            term: new Terminal({
                cursorBlink: false,
                theme: {
                    background: '#000000',
                    foreground: '#ffffff',
                },
                fontFamily: 'Noto Sans Mono',
                fontSize:12,
                lineHeight:1.1
            })
        },
        previous: {
            term: new Terminal({
                cursorBlink: false,
                theme: {
                    background: '#000000',
                    foreground: '#ffffff',
                },
                fontFamily: 'Noto Sans Mono',
                fontSize:12,
                lineHeight:1.1
            })
        }
    };

    for (let key in terminals) {
        let ct = terminals[key];
        ct.fitAddon = new FitAddon.FitAddon();
        ct.term.loadAddon(ct.fitAddon);
        ct.fitAddon.fit();
        ct.term.write("\x1b[?25l");
    }

    myLayout.init();

    window.setTimeout(()=>{
        for(let i=0;i<terminals.calc.term.rows-1;i++)
            terminals.calc.term.writeln("");
        terminals.calc.term.write('Programmer\'s Calculator. Use \'?\' to bring up help, up/down arrow keys for history.');
        $('#readline').keyup( onInputKey );
        $('#readline').keydown( onInputCursor );
    },50)

    writePrompt();
    updateModeIndicator();
//    terminals.calc.term.onKey(({key, domEvent}) => onKey(key,domEvent));

}

/**
 *
 */
function ensureHelpDocumentActive() {
    let isHelpDocOpen = false;
    let allStacks = myLayout.root.getItemsByType('component');

    allStacks.forEach(function(stack) {
        if (stack.config.componentName === 'helpDocumentComponent') {
            isHelpDocOpen = true;
            stack.parent.setActiveContentItem(stack);
        }
    });

    if (!isHelpDocOpen) {
        myLayout.root.contentItems[0].addChild({
            type: 'component',
            componentName: 'helpDocumentComponent',
            title: 'Help Document'
        });
    }
}


//window.addEventListener('resize', () => fitAddon.fit());

let prompt = 'dec $';
let commandHistory = [];
let historyIndex = -1;
let cursorPosition = 0;
let insertMode = true;
let currentLine = '';

function writePrompt() {
//    terminals.calc.term.write('\r\n' + prompt + " ");
//    cursorPosition = 0;
}

function updateModeIndicator() {
}

function onInputKey(e) {
    switch(e.originalEvent.key) {
        case 'Enter':
            let currentLine = $('#readline').val();
            if (currentLine.trim().length ===0)
                return;
            commandHistory.push(currentLine.trim());
            historyIndex = commandHistory.length;
            let tokens;
            terminals.calc.term.write('\r\n>>>> '+currentLine+"\r\n");
            if ((tokens = handleInput(currentLine.trim())) !== false) {
                if (processTokens(tokens))
                    executeTokens(tokens);
            }
            $('#readline').val('');
            break;
    }
}

function onInputCursor(e) {
    switch(e.originalEvent.key) {
        case 'ArrowUp':
            if (historyIndex > 0) {
                historyIndex--;
                currentLine = commandHistory[historyIndex];
                cursorPosition = currentLine.length;
                $('#readline').val(currentLine);
            }
            break;
        case 'ArrowDown':
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                currentLine = commandHistory[historyIndex];
                cursorPosition = currentLine.length;
                $('#readline').val(currentLine);
            } else if (historyIndex === commandHistory.length - 1) {
                historyIndex = commandHistory.length;
                currentLine = '';
                cursorPosition = 0;
                $('#readline').val(currentLine);
            }
            break;
    }
}

/**
 * claude.ai built this, doesn't work properly, don't have time to look at it.
 * @param key
 * @param domEvent
 */
function onKey(key,domEvent) {
    const printable = !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;
    let terminal = terminals.calc.term;

    if (domEvent.keyCode === 13) { // Enter key
        if (currentLine.trim().length > 0) {
            commandHistory.push(currentLine.trim());
            historyIndex = commandHistory.length;
        }
        let tokens;
        terminal.write('\r\n');
        if ((tokens = handleInput(currentLine.trim())) !== false) {
            if (processTokens(tokens))
                executeTokens(tokens);
        }
        currentLine = '';
        cursorPosition = 0;
        writePrompt();
    } else if (domEvent.keyCode === 8) { // Backspace
        if (cursorPosition > 0) {
            currentLine = currentLine.slice(0, cursorPosition - 1) + currentLine.slice(cursorPosition);
            cursorPosition--;
            terminal.write('\b \b');
            terminal.write(currentLine.slice(cursorPosition));
            terminal.write('\x1b[' + (currentLine.length - cursorPosition) + 'D');
        }
    } else if (domEvent.keyCode === 37) { // Left arrow
        if (cursorPosition > 0) {
            cursorPosition--;
            terminal.write('\x1b[D');
        }
    } else if (domEvent.keyCode === 39) { // Right arrow
        if (cursorPosition < currentLine.length) {
            cursorPosition++;
            terminal.write('\x1b[C');
        }
    } else if (domEvent.keyCode === 38) { // Up arrow
        if (historyIndex > 0) {
            historyIndex--;
            currentLine = commandHistory[historyIndex];
            cursorPosition = currentLine.length;
            terminal.write('\r' + prompt + ' '.repeat(currentLine.length));
            terminal.write('\r' + prompt + currentLine);
        }
    } else if (domEvent.keyCode === 40) { // Down arrow
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            currentLine = commandHistory[historyIndex];
            cursorPosition = currentLine.length;
            terminal.write('\r' + prompt + ' '.repeat(currentLine.length));
            terminal.write('\r' + prompt + currentLine);
        } else if (historyIndex === commandHistory.length - 1) {
            historyIndex = commandHistory.length;
            currentLine = '';
            cursorPosition = 0;
            terminal.write('\r' + prompt + ' '.repeat(currentLine.length));
            terminal.write('\r' + prompt);
        }
    } else if (domEvent.keyCode === 45) { // Insert key
        insertMode = !insertMode;
        updateModeIndicator();
    } else if (printable) {
        if (insertMode || cursorPosition === currentLine.length) {
            currentLine = currentLine.slice(0, cursorPosition) + key + currentLine.slice(cursorPosition);
            cursorPosition++;
            terminal.write(key);
            if (cursorPosition < currentLine.length) {
                terminal.write(currentLine.slice(cursorPosition));
                terminal.write('\x1b[' + (currentLine.length - cursorPosition) + 'D');
            }
        } else {
            currentLine = currentLine.slice(0, cursorPosition) + key + currentLine.slice(cursorPosition + 1);
            terminal.write(key);
            cursorPosition++;
        }
    }
}

function handlePaste(text) {
    const cleanText = text.replace(/[\r\n]+/g, ' ');
    if (insertMode) {
        currentLine = currentLine.slice(0, cursorPosition) + cleanText + currentLine.slice(cursorPosition);
    } else {
        currentLine = currentLine.slice(0, cursorPosition) + cleanText + currentLine.slice(cursorPosition + cleanText.length);
    }
    terminals.calc.term.write(cleanText);
    cursorPosition += cleanText.length;
    if (cursorPosition < currentLine.length) {
        terminals.calc.term.write(currentLine.slice(cursorPosition));
        terminals.calc.term.write('\x1b[' + (currentLine.length - cursorPosition) + 'D');
    }
}

const modes = {d: 'dec', x: 'hex', o: 'oct', b: 'bin'};
let mode = 'd';
let previous = [];
let memories = new Map();
let memoriesChanged = false;
let precision = 64;

const regexMatches={
    element:0,
    operator:1,
    memory:2,
    memoryNumber:4,
    memoryOperation:5,
    memoryName:6,
    previous:7,
    previousNumber:8,
    literal:9,
    literalPrefix:10,
    nonMatching:11
};

function handleInput(input) {
    input=input.trim();

    if (input.length === 1 && 'dxob'.includes(input[0].toLowerCase())) {
        changeMode(input[0].toLowerCase());
        return false;
    } else if (input==='?') {
        ensureHelpDocumentActive();
        return false;
    }

    let processedTokens = [];
    const pattern = /([+\-*/&|%!^~]|>>>|>>|<<)|(([mM])(\d+)?([rcs+\-*/&|^]|>>>|>>|<<)?(\".*?\")?)|(p)(\d+)?|((0?[dxobDXOB])?[a-fA-F0-9]+)|(.+?)/g;
    const tokens = input.matchAll(pattern);

    function addToken(type,value,extra,extra2) {
        processedTokens.push({ type:type, value:value, extra:extra,extra2:extra2});
    }

    for (let token of tokens) {
        try {
            console.log(token);
            if (token[regexMatches.operator] !== undefined) {
                // operator
                addToken('operator', token[1] );
            } else if (token[regexMatches.memory] !== undefined) {
                // memory
                let memNumber = token[regexMatches.memoryNumber]===undefined ? 1 : Number.parseInt(token[4]);
                let memOperator = token[regexMatches.memoryOperation]===undefined ? 'r' : token[5];
                let name = token[regexMatches.memoryName];
                if (name!==undefined)
                    name=name.slice(1,-1);

                if (memOperator==='r')
                    addToken('memoryRead',memNumber,undefined,name);
                else
                    addToken('memory',memNumber,memOperator,name);
            } else if (token[regexMatches.previous] !== undefined) {
                // previous answer
                addToken('previous', parseInt(token[regexMatches.previousNumber]===undefined ? 0 : token[7]));
            } else if (token[regexMatches.literal] !== undefined) {
                let literal = token[regexMatches.literal];
                let prefix = token[regexMatches.literalPrefix];
                if ( prefix!==undefined ) {
                    if ( prefix[0]!=='0' ) {
                        literal = "0" + literal;
                        prefix = "0" + token[9];
                    }
                    if ( prefix==='0d' )
                        addToken('literal', BigInt(literal.substring(2)) );
                    else
                        addToken('literal', BigInt(literal) );
                } else {
                    if (mode==='d')
                        addToken('literal', BigInt(literal) );
                    else
                        addToken('literal', BigInt("0"+mode+literal) );
                }
                console.log("here");
            } else if (token[regexMatches.nonMatching] !== undefined && token[regexMatches.nonMatching].trim().length > 0) {
                // if not blank, something invalid
                throw "";
            }
        } catch (e) {
            terminals.calc.term.write("Invalid : "+token[0]+"\r\n");
            return false;
        }
    }

    return processedTokens;
}

/**
 * Get value from memory
 * @param index
 */
function memoryRead(index) {
    if (memories[index]===undefined)
        throw `Memory ${index} is undefined.`
    else
        return memories[index].value;
}

/**
 * Get value from previous
 * @param index
 * @returns {*}
 */
function getPrevious(index) {
    if ( previous[index]===undefined )
        throw `There is no previous value with index ${index}`;
    return previous[index];
}

/**
 * Push value onto previous stack
 * @param value
 */
function pushPrevious(value) {
    previous.unshift(value);
    if(previous.length>15)
        previous.pop();
}

/**
 *
 */
function refreshPrevious() {
    let t = terminals.previous.term;
    t.clear();
    let blanks = " ".repeat(44);
    for( let i in previous ) {
        t.writeln("\x1b[7;1m"+blanks+"Previous #"+i+blanks+"\x1b[0m");
        writeValue(t,previous[i],true);
        
    }
    window.setTimeout( ()=>{terminals.previous.term.scrollToTop()},20);
}

/**
 *
 */
function refreshMemories() {
    let t = terminals.memory.term;
    t.clear();
    let blanks = " ".repeat(44);
    let keys = [...memories.keys()].sort();
    for( let key of keys ) {
        t.write("\x1b[7;1m  "+key+" ");
        let name = memories.get(key).name;
        name= name===undefined ? "" : name;
        t.writeln(name+"\x1b[0m");
        writeValue(t,memories.get(key).value,true);
    }
    window.setTimeout( ()=>{terminals.previous.term.scrollToTop()},20);
}

/**
 *
 * @param tokens
 * @param index
 */
function identifyNegateTokenIdiom(tokens,index) {
    if ( tokens[index].type==='operator' && tokens[index].value==='-' &&
        (tokens[index+1].type==='literal'  ||  tokens[index+1].type==='previous' || tokens[index+1].type==='memoryRead' ) ) {
        tokens[index+1].negate=true;
        tokens.splice(index,1);
    }

}
/**
 * go through and identify negative literals or memory/previous
 * @param tokens
 */
function processTokens(tokens) {
    if (tokens.length<2)
        return true;

    identifyNegateTokenIdiom(tokens,0);

    let index=0;
    while(index<=tokens.length-3) {
        if ( tokens[index].type==='operator' )
            identifyNegateTokenIdiom(tokens,index+1);
        index++;
    }
    return true;
}


/**
 * Set the memory and change name if it is set
 * @param memoryNumber
 * @param value
 * @param name
 */
function setMemoryChangeName(memoryNumber,value,name) {
    memoryNumber = Number.parseInt(memoryNumber);
    let current = memories.get(memoryNumber);
    if (current===undefined)
        memories.set(memoryNumber, {value:value, name:name})
    else {
        current.value = value;
        if (name!==undefined)
            current.name=name;
    }
}

/**
 *
 * @param currentValue
 * @param memoryNumber
 * @param operator
 * @param name
 * @returns {*}
 */
function memoryOperation(currentValue,memoryNumber,operator, name) {
    memoriesChanged=true;

    if (operator==='s')
        setMemoryChangeName(memoryNumber, currentValue, name);
    else {
        let currentMemoryValue = memories.get(memoryNumber);
        if (currentMemoryValue===undefined)
            throw `Memory ${memoryNumber} is not set`;

        if (operator==='c') {
            if ( currentMemoryValue.name!==undefined)
                currentMemoryValue.value=0n;
            else
                memories.delete(memoryNumber);
        } else {
            currentValue = applyOperator(currentMemoryValue.value,currentValue,operator);
            setMemoryChangeName(memoryNumber,currentValue,name)
        }
    }
}

function applyOperator(lvalue, rvalue, operator) {
    console.log(`${lvalue} ${operator} ${rvalue}`);
    switch (operator) {
        case '+':
            return lvalue + rvalue;
        case '-':
            return lvalue - rvalue;
        case '*':
            return lvalue * rvalue;
        case '/':
            let mod = lvalue % rvalue;
            if (mod===0n) {
                terminals.calc.term.writeln("  Modulo was 0");
            } else {
                terminals.calc.term.writeln("  Modulo was ");
                writeValue(terminals.calc.term,mod,true);
                terminals.calc.term.writeln("");
            }
            return lvalue / rvalue;
        case '^':
            return lvalue ^ rvalue;
        case '|':
            return lvalue | rvalue;
        case '%':
            return lvalue % rvalue;
        case '&':
            return lvalue & rvalue;
        case '<<':
            return lvalue << rvalue;
        case '>>':
            return lvalue >> rvalue;
        case '>>>':
            throw new Error(">>> not supported yet");
            return lvalue >>> rvalue;
        default:
            throw new Error("Unsupported operator");
    }
}

/**
 *
 * @param tokens
 */
function executeTokens(tokens) {
    let oldPrevious = [...previous];
    let oldMemories = new Map(memories);
    memoriesChanged=false;

    let lValue = previous.length>0 ? previous[0] : 0n;
    let rValue = null;

    try {
        for( let i=0; i<tokens.length; i++) {
            let token = tokens[i];
            console.log(token);
            let nextToken = (i+1<tokens.length) ? tokens[i+1] : { type:'none' };
            switch(token.type) {
                case 'literal':
                    // look for negative
                    if ( token.value > BigInt(1)<<BigInt(precision-1) )
                        token.value-= BigInt(1) << BigInt(precision);
                    lValue = token.negate ? (-token.value) : token.value;
                    console.log(lValue);
                    break;
                case 'operator':
                    if (token.value==='!')
                        lValue = ~lValue;
                    else if (token.value==='~')
                        lValue = -lValue;
                    else {
                        // look at next token. need an rValue.
                        if ( nextToken.type==='literal' )
                            rValue = nextToken.value;
                        else if (nextToken.type==='previous')
                            rValue = getPrevious(nextToken.value);
                        else if( nextToken.type==='memoryRead' )
                            rValue = memoryRead(nextToken.value,nextToken.extra2)
                        else
                            throw "Needs a value after "+token.value;

                        lValue = applyOperator(lValue,rValue,token.value);
                        i++;
                    }
                    break;
                case 'memoryRead':
                    lValue = memoryRead(lValue,token.value,token.extra2);
                    break;
                case 'memory':
                    memoryOperation(lValue,token.value,token.extra,token.extra2);
                    break;
                case 'previous':
                    lValue=getPrevious(token.value);
            }
        }
        writeValue(terminals.calc.term,lValue);
        pushPrevious(lValue);
        refreshPrevious();
        if (memoriesChanged)
            refreshMemories();
    } catch (e) {
        terminals.calc.term.writeln(e.toString());
        previous = oldPrevious;
        memories = oldMemories;
        return false;
    }
    return true;
}

/**
 *
 * @param newMode
 */
function changeMode(newMode) {
    mode = newMode;
    prompt = modes[newMode] + " $"
    $('#mode').html(modes[newMode]+" : ");
    terminals.calc.term.writeln(`Default input radix changed to ${modes[newMode]}`);
}


/**
 *
 * @param bigint
 * @param bits
 * @returns {bigint}
 */
function truncateSigned(bigint, bits) {
    const mask = (1n << BigInt(bits)) - 1n;
    const truncated = bigint & mask;
    const signBit = 1n << (BigInt(bits) - 1n);
    if (truncated & signBit) {
        // If the sign bit is set, extend the sign
        return truncated - (1n << BigInt(bits));
    }
    return truncated;
}

/**
 *
 * @param spacing
 * @param distance
 * @param string
 * @param pad
 * @returns {string}
 */
function insertSpacing( spacing,distance,string,pad) {
    let negative = string[0]==='-';
    // Reverse the string
    let reversedString = string.split('').reverse().join('');
    if (negative)
        reversedString = reversedString.slice(0,-1);
   // Insert spacing
    let r = new RegExp(`(.{${distance}})`,"g");
    let spacedReversedString = reversedString.replace(r, '$1'+spacing);
    // Reverse the string back and trim any trailing space
    let finalString = spacedReversedString.split('').reverse().join('');
    if (finalString[0]===spacing)
        finalString = finalString.substring(1);
    if (negative)
        finalString="-"+finalString;
    if (pad!==undefined)
        finalString = finalString.padStart(pad," ");
    return finalString;
}

function formatValue(value, bits, radix, signed, decimalWidth, extraSpaces) {
    if (decimalWidth===undefined)
        decimalWidth = Math.ceil(bits * Math.log10(2));
    decimalWidth += Math.floor(decimalWidth/3 ) + (signed?1:0);                // add comma space

    const truncatedValue = signed ? BigInt.asIntN(bits,value) : BigInt.asUintN(bits,value);

    let overflow=false;
    if (radix!==10)
        signed=false;

    if (signed && (value>BigInt(2n ** BigInt(bits-1) -1n)) || value<(-BigInt(2n ** BigInt(bits-1) )))
        overflow = true;
    else if (!signed && value>BigInt(2n ** BigInt(bits) -1n))
        overflow = true;

    let spacing;
    let spaceFill=' ';
    let stringValue;
    let radixString;
    let colour = 92;
    switch (radix) {
        case 2:
            stringValue = truncatedValue.toString(2).padStart(bits, '0');
            spacing=4;
            radixString='b';
            break;
        case 3:
            stringValue = truncatedValue.toString(8).padStart(Math.ceil(bits / 3), '0');
            spacing=3;
            radixString='o';
            break;
        case 16:
            stringValue = truncatedValue.toString(16).padStart(Math.ceil(bits / 4), '0');
            spacing=4;
            radixString='x';
            break;
        default:
            stringValue = truncatedValue.toString(radix);
            spacing = 3;
            spaceFill = ',';
            radixString = signed ? 's' : 'u';
            colour = signed ? 93 : 96;
            break;
    }

    stringValue = insertSpacing(spaceFill,spacing,stringValue);
    stringValue = stringValue.padEnd(decimalWidth - (signed?1:0));
    if (signed && truncatedValue>=BigInt(0))
        stringValue = " "+stringValue;

    if (overflow)
        colour = 91;
    if (extraSpaces===undefined)
        extraSpaces= "";
    else
        extraSpaces = ' '.repeat(extraSpaces);

    const idLength = (""+precision).length+1;
    const id = (radixString+bits).padStart(idLength,' ');

    const header = `\x1b[1;${colour}m${id}\x1b[0;m`;

    return header+": "+extraSpaces+stringValue;
}

function writeValue(terminal, value, compact) {
    terminal.write( "  "+formatValue(value, 64, 16));
    if (!compact)
        terminal.write("\r\n");
//    terminal.writeln( "  "+formatValue(value,64,3));
//    terminal.writeln( "  "+formatValue(value,64,2));

    terminal.write( "  " + formatValue(value, 64, 10, true, 19)+"  "+formatValue(value, 64, 10, false, 19));
    terminal.write("\r\n");
    terminal.write( "  " + formatValue(value, 32, 10, true, 11) + "  " + formatValue(value, 32, 10, false, 11));
    if (!compact)
        terminal.write("\r\n");
    terminal.write( "  " + formatValue(value, 16, 10, true, compact? 5 : 11) + "  " + formatValue(value, 16, 10, false, compact? 5 : 11));
    if (!compact)
        terminal.write("\r\n");
    terminal.write( "  " + formatValue(value, 8, 10, true, compact? 4 : 11) + "  " + formatValue(value, 8, 10, false, compact? 5 : 11));
    terminal.write("\r\n");
}
