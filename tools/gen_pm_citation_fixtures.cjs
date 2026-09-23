const {Schema, Node} = require('prosemirror-model');
const schema = new Schema({
  nodes: {
    doc: {content: 'block+'},
    paragraph: {group:'block', content:'inline*', toDOM:()=>['p',0]},
    heading: {group:'block', content:'inline*', attrs:{level:{default:1}}, toDOM:()=>['h1',0]},
    blockquote: {group:'block', content:'block+', toDOM:()=>['blockquote',0]},
    bulletList: {group:'block', content:'listItem+', toDOM:()=>['ul',0]},
    listItem: {content:'paragraph+', toDOM:()=>['li',0]},
    text: {group:'inline'},
    attachmentChip: {group:'inline', inline:true, atom:true, attrs:{name:{default:'file'}}, toDOM:()=>['a']},
    documentExcerpt: {group:'block', atom:true, toDOM:()=>['div']},
    askInsert: {group:'block', content:'block+', toDOM:()=>['div',0]},
    askCitation: {group:'inline', inline:true, atom:true, attrs:{n:{default:null}}, toDOM:()=>['span']},
  },
  marks: { bold:{toDOM:()=>['strong',0]}, italic:{toDOM:()=>['em',0]}, link:{attrs:{href:{default:''}},toDOM:()=>['a',0]} },
});
const CASES = {
  simple: {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Hello world.'}]}]},
  markBoundary: {type:'doc',content:[{type:'paragraph',content:[
    {type:'text',text:'Management expects '},
    {type:'text',text:'gross margins',marks:[{type:'bold'}]},
    {type:'text',text:' to normalize lower.'}]}]},
  adjacentMarks: {type:'doc',content:[{type:'paragraph',content:[
    {type:'text',text:'a'},
    {type:'text',text:'b',marks:[{type:'bold'}]},
    {type:'text',text:'c',marks:[{type:'italic'}]},
    {type:'text',text:'d',marks:[{type:'bold'},{type:'italic'}]},
    {type:'text',text:'e'}]}]},
  twoParas: {type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'First para.'}]},
    {type:'paragraph',content:[{type:'text',text:'Second para.'}]}]},
  headingAndPara: {type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'NVDA Thesis'}]},
    {type:'paragraph',content:[{type:'text',text:'Margins normalize.'}]}]},
  nestedList: {type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'Risks:'}]},
    {type:'bulletList',content:[
      {type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'China exposure'}]}]},
      {type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Customer concentration'}]}]}]}]},
  blockquote: {type:'doc',content:[
    {type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'Quoted claim.'}]}]},
    {type:'paragraph',content:[{type:'text',text:'After.'}]}]},
  linkAcross: {type:'doc',content:[{type:'paragraph',content:[
    {type:'text',text:'see '},
    {type:'text',text:'the filing',marks:[{type:'link',attrs:{href:'https://x'}}]},
    {type:'text',text:' for detail'}]}]},
  duplicatePhrase: {type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'Revenue was strong.'}]},
    {type:'paragraph',content:[{type:'text',text:'Revenue guidance was raised.'}]}]},
  askCitationChip: {type:'doc',content:[{type:'paragraph',content:[
    {type:'text',text:'Margins fell '},
    {type:'askCitation',attrs:{n:1}},
    {type:'text',text:' in Q3.'}]}]},
  askInsertBlock: {type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'My own view.'}]},
    {type:'askInsert',content:[
      {type:'paragraph',content:[
        {type:'text',text:'Inserted answer '},
        {type:'askCitation',attrs:{n:1}},
        {type:'text',text:' here.'}]}]},
    {type:'paragraph',content:[{type:'text',text:'After.'}]}]},
};
const out = {};
for (const [name, json] of Object.entries(CASES)) {
  const doc = Node.fromJSON(schema, json);
  const spans = [];
  doc.descendants((node, pos) => { if (node.isText) spans.push({pm_start: pos, pm_end: pos + node.nodeSize, text: node.text}); });
  out[name] = { json, text: doc.textBetween(0, doc.content.size, '\n'), contentSize: doc.content.size, textSpans: spans };
}
console.log(JSON.stringify(out, null, 1));
