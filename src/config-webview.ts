export function getRulesHtml(
    rules: Record<string,string[]>
): string {


const data =
    JSON.stringify(rules);


return `
<!DOCTYPE html>
<html>
<head>
<style>

body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding:20px;
}


.encoding {
    border:1px solid var(--vscode-panel-border);
    padding:12px;
    margin-bottom:20px;
}


input {
    width:80%;
    padding:6px;
    margin:4px;
    background:var(--vscode-input-background);
    color:var(--vscode-input-foreground);
    border:1px solid var(--vscode-input-border);
}


button {
    margin:4px;
}


.pattern {
    display:flex;
    align-items:center;
}


</style>
</head>


<body>


<h2>Encoding Rules</h2>


<div id="root"></div>


<button onclick="addEncoding()">
+ Add Encoding
</button>


<button onclick="save()">
Save
</button>



<script>


const vscode = acquireVsCodeApi();


let rules = ${data};



function render(){

const root =
document.getElementById("root");


root.innerHTML="";


Object.keys(rules)
.forEach(enc=>{


let box =
document.createElement("div");


box.className="encoding";


box.innerHTML =
\`
<h3>
\${enc}
<button onclick="removeEncoding('\${enc}')">
🗑
</button>
</h3>
\`;


rules[enc].forEach(
(pattern,index)=>{


let row =
document.createElement("div");


row.className="pattern";


row.innerHTML =
\`
<input value="\${pattern}"
onchange="updatePattern(
'\${enc}',
\${index},
this.value
)">
<button onclick="removePattern(
'\${enc}',
\${index}
)">
🗑
</button>
\`;


box.appendChild(row);


});


let add =
document.createElement("button");

add.textContent =
"+ Add pattern";


add.onclick =
()=>{

rules[enc].push("");

render();

};


box.appendChild(add);


root.appendChild(box);


});


}



function addEncoding(){

let name =
prompt("Encoding name:");

if(!name)
return;


rules[name]=[];

render();

}



function removeEncoding(enc){

delete rules[enc];

render();

}



function updatePattern(enc,i,value){

rules[enc][i]=value;

}



function removePattern(enc,i){

rules[enc].splice(i,1);

render();

}



function save(){

vscode.postMessage({

command:"save",

rules

});


}



render();


</script>


</body>
</html>
`;
}