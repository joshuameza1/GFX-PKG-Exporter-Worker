const fs = require('fs');
const fsPromises = fs.promises;
const aepx = require('aepx');
const env = require("dotenv");
const { EOL } = require('os');
// const socket = require("../socket_io/request.js");

// env.config();

const watch_folder = process.env.WATCH_FOLDER;

let templateComps = [];
let compatibleFiles = [];
let graphics = [];


async function initializeSlackUI(socket) {

  let templateProject = await getTemplateProject();

  return updateSlackAppUI(templateProject, socket);
}

async function getTemplateProject(){
  let compatibleFiles = [];
    let files = await listDir(watch_folder);
    for (const file of files) {
        if (file.includes('.aepx') && !file.split(EOL).pop().startsWith('.')){
            compatibleFiles.push(file);
        }
    }

    let fileName = compatibleFiles[0];

    let newFilePath = watch_folder + fileName;

    return {name:fileName, path: newFilePath, directory: watch_folder}
};

async function updateSlackAppUI(templateProject, socket) {
  let graphics = await getGraphics(templateProject);
  socket.emit("updateSlackAppUI", graphics);
  console.log(graphics);
};

async function getGraphics(templateProject) {
  
  let fileName = templateProject.name
  let filePath = templateProject.path
  let fileDirectory = templateProject.directory

  await checkNumOfFilesinDir(fileDirectory);

  graphics = [];
  templateComps = [];

  let projectJson = await converProjectToJSON(`${filePath}`)
  templateComps = await getTemplateComps(projectJson);

  for (const thisComp of templateComps){
        let thisName = thisComp.string.replace("^","").split("_").join(" ");
        let comp_settings = {
          preview_frame: Math.round(((thisComp.cdta.duration-1)-thisComp.cdta.startFrame)/2),
        }
        let thisButton = {
          name: thisName,
          action_id: "Create_" + thisName.split(" ").join("_")
        };
        let final_frames = []
        let multiple_renders = 0;
        let theseTextInputs = [];
        let theseCheckboxInputs = [];
        let theseLayers = thisComp.layr;
        
        for (const thisLayer of theseLayers){
            if (thisLayer.ldta.asset_type == 3 && thisLayer.string[0] == "^") {
                theseTextInputs.push({
                  name: thisLayer.string.replace("^", "")/*.replace("*", "")*/,
                  action_id: thisLayer.string.replace("^", "").replace("*", "").replace(" ", "_"),
                  required: thisLayer.string.includes("*")
                })
            }
            if (thisLayer.ldta.asset_type == 0 && thisLayer.string[0] == "^") {
              theseCheckboxInputs.push({
                name: thisLayer.string.replace("^", "").replace("*", ""),
                action_id: thisLayer.string.replace("^", "").replace("*", "").replace(" ", "_")
              })
            }
            if (thisLayer.ldta.asset_type == 0 && thisLayer.string[0] == "#") {
              multiple_renders = 1;
              final_frames.push({
                suffix: `_${thisLayer.string.replace("#", "")}`,
                start_frame: Math.round((thisLayer.ldta.startTimeline+thisLayer.ldta.startFrame)*thisComp.cdta.frameRate),
                end_frame: Math.round((thisLayer.ldta.startTimeline+thisLayer.ldta.duration)*thisComp.cdta.frameRate)-1,
              }
              )
            }
        }

        if (multiple_renders == 0) {
          final_frames = [{
            suffix: "",
            start_frame: thisComp.cdta.startFrame,
            end_frame: thisComp.cdta.startFrame+thisComp.cdta.duration-1,
          }];
        }

        comp_settings.final_frames = final_frames;
        
        

        graphics.push({
            gfxpkg: fileName.split("_")[0],
            comp_settings: comp_settings,
            button: thisButton,
            text_inputs: theseTextInputs,
            checkbox_inputs : theseCheckboxInputs
        })
    }
    
    return graphics;
}

async function converProjectToJSON(filePath){
    try {
      let projectJson = aepx.parseFileSync(filePath)
        //let projectJson = await aepx.parseFile(filePath);
        return projectJson.fold.items;
      } catch (error) {
        console.error(error);
      }
}

async function getTemplateComps(array) {
    for  (const thisEntry of array){
        let thisEntryType = thisEntry.idta.entry_type;
        if(thisEntryType == 4 && thisEntry.string.includes("^")){
            templateComps.push(thisEntry);
        } else if(thisEntryType == 1 && thisEntry.sfdr.items.length > 0){
                await getTemplateComps(thisEntry.sfdr.items)
            }
    }
    return templateComps;
}

async function checkNumOfFilesinDir(filePath) {
    compatibleFiles = [];
    let files = await listDir(filePath);
    for (const file of files) {
        if (file.includes('.aepx')){
            compatibleFiles.push(file);
        }
    }
    fileName = compatibleFiles[0];

    return filePath + fileName;
}

async function listDir(filePath) {
  try {
    return fsPromises.readdir(filePath);
  } catch (err) {
    console.error('Error occured while reading directory!', err);
  }
}

module.exports = {
  initializeSlackUI,
  updateSlackAppUI,
  getTemplateProject
};