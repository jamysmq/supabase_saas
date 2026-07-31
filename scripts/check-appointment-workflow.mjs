import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflowPath = new URL('../n8n/WA_TENANT_APPOINTMENTS_INBOUND_v1.workflow.json', import.meta.url)
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'))

assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, 'Workflow sem nos')
assert.ok(workflow.connections && typeof workflow.connections === 'object', 'Workflow sem conexoes')

const nodeNames = new Set(workflow.nodes.map((node) => node.name))
for (const [source, groups] of Object.entries(workflow.connections)) {
  assert.ok(nodeNames.has(source), `Conexao parte de no inexistente: ${source}`)
  for (const outputs of Object.values(groups)) {
    for (const branch of outputs) {
      for (const connection of branch) {
        assert.ok(nodeNames.has(connection.node), `Conexao aponta para no inexistente: ${connection.node}`)
      }
    }
  }
}

const codeNodes = workflow.nodes.filter((node) => typeof node.parameters?.jsCode === 'string')
assert.ok(codeNodes.length > 0, 'Workflow sem Code nodes')
for (const node of codeNodes) {
  assert.doesNotThrow(() => new Function(node.parameters.jsCode), `JavaScript invalido no no ${node.name}`)
}

const decisionCode = codeNodes.map((node) => node.parameters.jsCode).join('\n')

assert.match(decisionCode, /function parseCpf\(value\)/, 'Parser de CPF ausente')
assert.match(decisionCode, /replace\(\/\\D\/g, ''\)/, 'CPF nao remove pontuacao')
assert.match(decisionCode, /digits\.length !== 6 && digits\.length !== 8/, 'Datas compactas de 6 e 8 digitos nao estao cobertas')
assert.match(decisionCode, /yearText\.length === 2/, 'Ano com dois digitos nao esta coberto')
assert.match(decisionCode, /minutes <= 240; minutes \+= 30/, 'Duracoes nao estao limitadas a 4h em intervalos de 30min')
assert.match(decisionCode, /draft\.cpf \|\| null/, 'CPF opcional nao chega como null na criacao')
assert.match(decisionCode, /'collect_birth_date'/, 'Data de nascimento nao faz parte da coleta')
assert.match(decisionCode, /'collect_optional_cpf'/, 'CPF opcional nao aparece no fim da coleta')
assert.match(decisionCode, /Ver mais hor[aá]rios/i, 'Opcao de ver mais horarios ausente')

console.log(`Appointment workflow checks passed (${workflow.nodes.length} nodes, ${codeNodes.length} Code nodes).`)
