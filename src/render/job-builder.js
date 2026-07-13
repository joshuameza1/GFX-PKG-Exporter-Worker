const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const METADATA_KEYS = new Set([
  'timestamp', 'job_status', 'request_id', 'user_id', 'display_name',
  'campus', 'gfxpkg', 'type', 'preview', 'preview_frame', 'final_frames',
  'outputModule', 'outputExt',
]);

function extractTemplateFields(request) {
  return Object.entries(request)
    .filter(([key]) => !METADATA_KEYS.has(key))
    .map(([key, value]) => {
      const isOpacity = Number.isInteger(value);
      return {
        type: 'data',
        layerName: `^${key.replace(/_/g, ' ')}`,
        property: isOpacity ? 'Opacity' : 'Source Text',
        value: String(isOpacity ? value * 100 : value),
      };
    });
}

function buildNexrenderConfigs(request, config) {
  const requestKey = `${request.gfxpkg}_${request.type.replace(/\s+/g, '_')}_${request.request_id}`;
  const outputDir = path.join(config.renderFolder, requestKey);

  fs.mkdirSync(outputDir, { recursive: true });

  const { resolveTemplatePath } = require('../templates/package-paths');
  const templatePath = resolveTemplatePath(config.watchFolder, request.gfxpkg);
  if (!templatePath) {
    throw new Error(
      `Template not found for "${request.gfxpkg}". ` +
      `Expected Watch/<name>/<name>.aepx (Collect Files) or Watch/<name>.aepx (legacy).`
    );
  }
  const templateProject = { path: templatePath };
  const assets = extractTemplateFields(request);

  const input = request.outputModule.includes('ProRes') ? 'result.mov' : 'result_00000.jpg';
  const outputModule = request.outputModule.includes('ProRes') && request.outputModule !== 'ProRes+Alpha'
    ? 'ProRes422'
    : request.outputModule;

  const configs = request.final_frames.map((frame, i) => {
    const jobName = `${request.gfxpkg}${frame.suffix}_${i + 1}`;
    const outputFile = path.join(outputDir, `${jobName}.${request.outputExt}`);

    const nexrenderConfig = {
      template: {
        src: `file:///${templateProject.path}`,
        composition: `^${request.type.split(' ').join('_')}`,
        outputModule,
        frameStart: frame.start_frame,
        frameEnd: frame.end_frame,
        frameIncrement: 1,
        outputExt: request.outputExt,
      },
      assets,
      actions: {
        postrender: [
          {
            module: '@nexrender/action-copy',
            input,
            output: outputFile,
          },
        ],
      },
      _jobName: jobName,
    };

    return nexrenderConfig;
  });

  return { requestKey, configs };
}

async function zipRenderFiles(renderFolder, requestKey) {
  const dirPath = path.join(renderFolder, requestKey);
  const zipPath = `${dirPath}.zip`;
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip');

  const promise = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  archive.directory(dirPath, false);
  archive.finalize();
  await promise;
}

module.exports = { buildNexrenderConfigs, extractTemplateFields, zipRenderFiles };
