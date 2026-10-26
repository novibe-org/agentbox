const spec = {
  paths: ['features/**/*.feature'],
  import: ['features/**/*.mjs'],
  tags: 'not @backlog',
  format: ['progress'],
}

export default spec

export const cloud = { ...spec, name: ['is closed to the internet', 'moves onto the developer\'s tailnet', 'cannot be reached over the tailnet stays open'] }
