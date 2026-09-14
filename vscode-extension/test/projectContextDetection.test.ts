import assert from 'node:assert/strict';
import test from 'node:test';

import { detectProjectContext } from '../src/projectContextDetection.js';

test('extracts only structured Java and Spring metadata from a pom', () => {
  const context = detectProjectContext([{
    name: 'pom.xml',
    content: `
      <project>
        <parent>
          <artifactId>spring-boot-starter-parent</artifactId>
          <version>4.1.1</version>
        </parent>
        <properties><java.version>21</java.version></properties>
      </project>`,
  }]);

  assert.deepEqual(context, {
    languages: [{ name: 'JAVA', version: '21' }],
    frameworks: [{ name: 'SPRING_BOOT', version: '4.1.1' }],
    buildTool: 'MAVEN',
  });
});

test('extracts Node, TypeScript and Angular versions from package metadata', () => {
  const context = detectProjectContext([{
    name: 'package.json',
    content: JSON.stringify({
      engines: { node: '>=22' },
      dependencies: { '@angular/core': '^20.1.0' },
      devDependencies: { typescript: '~7.0.2' },
      scripts: { secret: 'this content is not returned' },
    }),
  }]);

  assert.deepEqual(context, {
    languages: [
      { name: 'NODE', version: '22' },
      { name: 'TYPESCRIPT', version: '7.0.2' },
    ],
    frameworks: [{ name: 'ANGULAR', version: '20.1.0' }],
    buildTool: 'NPM',
  });
  assert.doesNotMatch(JSON.stringify(context), /this content is not returned/);
});

test('ignores malformed package metadata instead of sending file content', () => {
  assert.equal(detectProjectContext([{
    name: 'package.json',
    content: '{ invalid json containing private content',
  }]), undefined);
});
