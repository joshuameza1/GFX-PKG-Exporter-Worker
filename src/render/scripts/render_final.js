const exec = require('child_process').exec;
// const io = require("socket.io-client");
const fs = require("fs");
const fsPromises = require('fs/promises');
const archiver = require('archiver');
// const env = require("dotenv");
const {JsonDB, Config} = require("node-json-db");
const {getTemplateProject} = require("../../ae/ae_to_slack.js");


/** DOT ENV VARIABLES **/
const watch_folder = process.env.WATCH_FOLDER;
const render_folder = process.env.RENDER_FOLDER;
const render_folder2 = process.env.RENDER_FOLDER2;
const nexrender_json_folder = process.env.NEXRENDER_JSON_FOLDER;

/*------------------------------------------------------------------*/   

// TODO: replace with a properties array in the request [{name: 'Line One', value: 'Test'}, ...]
// let first_property = 0; // let last_property = 0;

// Generate all of the json render files for a request
async function generateRenderFiles(request) {
  let db = new JsonDB(new Config("./src/render/requests/requestHistory", true, false));
  db.push("/FinalRequests[]/", request, true);

  // Define a unique key for the request, and create the output folder
  let requestKey = `${request.gfxpkg}_${request.type.replace(/\s+/g, '_')}_${request.request_id}`;
  let outputPath = `${render_folder}${requestKey}`;
  await fsPromises.mkdir(outputPath);

  let jobNames = [];
  for (const thisRender of request.final_frames) {
    console.log("Generating JSON File...");

    // Define a unique name for the render job 
    let jobName = `${request.gfxpkg}${thisRender.suffix}_${jobNames.length+1}`;
    jobNames.push(jobName);
  
    let outputFile = `${outputPath}/${jobName}.${request.outputExt}`;
    //let outputFile2 = `${render_folder2}/${jobName}.${request.outputExt}`;
    let jsonData = await generateJsonFile(request, thisRender, outputFile);
    await fsPromises.writeFile(`${nexrender_json_folder}${jobName}_${request.request_id}.json`, JSON.stringify(jsonData), "utf8");
  }

  return {requestKey, jobNames};
}
//nexrender-cli --file Q:/GFX/generator/nexrender/DTNY_1_6664639166386.306808176327.ef6ee49bca032141d28d62f79a7a2de9.json
async function processRenderFiles({request, requestKey, jobNames = []}) {
  for (const jobName of jobNames) {
    let renderFilename = `${nexrender_json_folder}${jobName}_${request.request_id}.json`;
    console.log("Now Rendering...", renderFilename);
    await execShellCommand([`nexrender-cli --file ${renderFilename}`]);
    console.log('Render complete')
  }
  let fileLink = await getFileLink({request, requestKey, jobNames})
  let filename = `${requestKey}.${request.outputExt}`;
  return {filename, fileLink};
}

async function getFileLink({request, requestKey, jobNames = []}) {
  const prefix = `${process.env.CDN_URL}/${requestKey}`;
  if (jobNames.length === 1) {
    return `${prefix}/${jobNames[0]}.${request.outputExt}`;
  }
  await zipRenderFiles(requestKey);
  return `${prefix}.zip`;
}


async function zipRenderFiles(requestKey) {
  console.log('zipping files', requestKey);
  const directoryPath = `${render_folder}${requestKey}`
  const output = fs.createWriteStream(`${directoryPath}.zip`);
  const archive = archiver('zip');
  const promise = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.directory(directoryPath, false);
  archive.finalize();
  return promise;
}

async function execShellCommand(cmds) {
  return new Promise((resolve, reject) => {
      for (let i = 0; i < cmds.length; i++) {
          exec(cmds[i], (error, stdout, stderr) => {
              if (error) {
                  console.error(`Error executing command: ${cmds[i]}`);
                  console.error(`Error: ${error.message}`);
                  console.error(`stderr: ${stderr}`);
                  reject(error);
              }
              console.log(`stdout: ${stdout}`);
              resolve(stdout ? stdout : stderr);
          });
      }
  });
};

function defineFirstProperty(request) {
  let first_property = 0;
  for (let i = 0; i < Object.keys(request).length; i++) {
    if(Object.keys(request)[i]=="type"){
      first_property = i+1;
      break;
    }
  }
  return first_property;
}

function defineLastProperty(request) {
  let last_property = 0;
  for (let i = 0; i < Object.keys(request).length; i++) {
    if(Object.keys(request)[i]=="preview"){
      last_property = i;
      break;
    }
  }
  return last_property;
}

  async function generateJsonFile(request, thisRender, outputFile) {
    let first_property = defineFirstProperty(request);
    let last_property = defineLastProperty(request);

    console.log("Request Data:", request);
    console.log("First Property:", first_property, "Last Property:", last_property);

    let jsonData = {};

    let input = "result_00000.jpg";
    let {outputModule} = request;
    if (outputModule.includes("ProRes")) {
      input = "result.mov"
    }

    let templateProject = await getTemplateProject(watch_folder);

    let templateBlock = {
        "src": `file:///${templateProject.path}`,
        "composition": `^${request.type.split(" ").join("_")}`,
        "outputModule": outputModule.includes('ProRes') && outputModule !== 'ProRes+Alpha' ? 'ProRes422' : outputModule,
        "frameStart": thisRender.start_frame,
        "frameEnd": thisRender.end_frame,
        "frameIncrement": 1,
        "outputExt": `${request.outputExt}`
    }
    jsonData["template"] = templateBlock;


    let assetsBlock = [];

    for(let i = first_property; i < last_property; i++){
      let thisValue = Object.values(request)[i];
      let property = "";
      if (Number.isInteger(thisValue)){
        thisValue = thisValue*100;
        property = "Opacity";
      } else {
        property = "Source Text";
      }
      let thisAsset = {
          "type": "data",
          "layerName": `^${Object.keys(request)[i].split("_").join(" ")}`,
          "property": `${property}`,
          "value": `${thisValue}`
      }
      console.log(thisAsset)

      assetsBlock = assetsBlock.concat(thisAsset);
    }
    jsonData["assets"] = assetsBlock;

    let actionsBlock = {
      "postrender": [
        {
            "module": "@nexrender/action-copy",
            "input": `${input}`,
            "output": outputFile,
        }
    ]
    };

    console.log(actionsBlock)

    jsonData["actions"] = actionsBlock;

    return jsonData;
};

module.exports = {
  generateRenderFiles,
  processRenderFiles,
}



// async function deleteFile(filename) {
//   let filePath = `${render_folder}${filename}`
//   try {
//     fs.unlinkSync(filePath);
//     console.log(`Deleted ${filePath}`);
//   } catch (error) {
//     console.error(`Got an error trying to delete the file: ${error.message}`);
//   }
// }


// function titleCase(str) {
//   return str
//     .toLowerCase()
//     .split(" ")
//     .map(function(word) {
//       return word.charAt(0).toUpperCase() + word.slice(1);
//     })
//     .join(" ");
// };

// async function createFolder(folderName, folderId) {
//       try {
//         const response = await drive.files.create({
//             requestBody: {
//                 name: folderName,
//                 mimeType: 'application/vnd.google-apps.folder',
//                 parents: [folderId]
//                 },
//                 supportsAllDrives: true,
//             });
//             //console.log(response.data)
//             var folderId = response.data.id;
//         } catch (error) {
//             console.log(error.message)
//         }
//         return folderId;
// }

// async function uploadVideo(filename, folderId) {
//     const filePath = `${render_folder}${filename}`    
//     try {
      
//       const response = await drive.files.create({
//         requestBody: {
//           name: filename,
//           mimeType: 'video/quicktime',
//           parents: [folderId]
//         },
//         supportsAllDrives: true,
//         media: {
//           mimeType: 'video/quicktime',
//           body: fs.createReadStream(filePath)
//         }
//       })
  
//       console.log(response.data);
//       var link = "https://drive.google.com/file/d/" + response.data.id;
  
//     } catch (error) {
//       console.log(error.message)
//     }
  
//     return link;
// };
  
// async function uploadImage(filename, folderId) {
//     const filePath = `${render_folder}${filename}`
    
//     try {
      
//       const response = await drive.files.create({
//         requestBody: {
//           name: filename,
//           mimeType: 'image/jpg',
//           parents: [folderId]
//         },
//         supportsAllDrives: true,
//         media: {
//           mimeType: 'image/jpg',
//           body: fs.createReadStream(filePath)
//         }
//       })
//       var link = "https://drive.google.com/file/d/" + response.data.id;
  
//     } catch (error) {
//       console.log(error.message)
//     }
  
//     return link;
// };
