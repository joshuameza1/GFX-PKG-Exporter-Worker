const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
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
  if (!config.renderFolder) {
    throw new Error('Render folder is not set. Open Settings and save a render path.');
  }
  if (!config.watchFolder) {
    throw new Error('Watch folder is not set. Open Settings and save a packages path.');
  }
  if (!config.aerenderPath || !fs.existsSync(config.aerenderPath)) {
    throw new Error('aerender was not found. Install After Effects or set AERENDER_PATH.');
  }

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
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file missing: ${templatePath}`);
  }

  const templateSrc = pathToFileURL(templatePath).href;
  const assets = extractTemplateFields(request);
  const packageRoot = path.dirname(templatePath);

  const input = request.outputModule.includes('ProRes') ? 'result.mov' : 'result_00000.jpg';
  const outputModule = request.outputModule.includes('ProRes') && request.outputModule !== 'ProRes+Alpha'
    ? 'ProRes422'
    : request.outputModule;

  const frames = Array.isArray(request.final_frames) ? request.final_frames : [];
  if (!frames.length) {
    throw new Error(`No final_frames configured for "${request.type}"`);
  }

  const configs = frames.map((frame, i) => {
    const jobName = `${request.gfxpkg}${frame.suffix}_${i + 1}`;
    const outputFile = path.join(outputDir, `${jobName}.${request.outputExt}`);

    const nexrenderConfig = {
      template: {
        src: templateSrc,
        // Keep Collect Files packages in place so footage/relatives stay valid.
        // Copying only the .aepx into Work/ was crashing mid-download / breaking AE.
        useOriginal: true,
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
      _packageRoot: packageRoot,
    };

    return nexrenderConfig;
  });

  return { requestKey, configs, templatePath, templateSrc, packageRoot };
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
