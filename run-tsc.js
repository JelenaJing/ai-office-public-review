const { execSync } = require('child_process');

try {
  const result = execSync('node_modules\\.bin\\tsc --noEmit', {
    cwd: 'E:\\ai-office\\ai_writer3.0',
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('STDOUT:\n' + result);
} catch (error) {
  console.log('STDOUT:\n' + (error.stdout || ''));
  console.log('STDERR:\n' + (error.stderr || ''));
  console.log('EXIT CODE: ' + error.status);
}
