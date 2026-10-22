const spec = {
  paths: ['features/**/*.feature'],
  import: ['features/**/*.mjs'],
  tags: 'not @backlog',
  format: ['progress'],
}

export default spec

// The scenarios that need a real cloud and a real tailnet, which the cloud job runs.
export const cloud = { ...spec, name: ['is closed to the internet'] }
