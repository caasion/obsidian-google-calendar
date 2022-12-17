import { FrontMatterCache, MarkdownView, normalizePath, TFile } from "obsidian";
import { googleListCalendars } from "src/googleApi/GoogleListCalendars";
import  GoogleCalendarPlugin from 'src/GoogleCalendarPlugin';
import _ from "lodash";
import { createNotice } from "src/helper/NoticeHelper";
import { marked } from 'marked';
import RRule, { RRuleSet } from "rrule";

export const getEventFromFrontMatter = async (view: MarkdownView): Promise<FrontMatterCache> => {
    
    const plugin = GoogleCalendarPlugin.getInstance();

    const fileContent = await app.vault.adapter.read(normalizePath(view.file.path));

    //Use a copy to prevent problems when running the command multiple times
    const frontmatter:any = _.cloneDeep(app?.metadataCache?.getFileCache(view.file).frontmatter) ?? {};
    console.log(app.metadataCache.getFileCache(view.file))
    //Get dataview frontmatter form the file
    const regexp = /\[([^[]*)::([^[]*)\]/gm;
    let matches;
    const output = [];
    do {
        matches = regexp.exec(fileContent);
        output.push(matches);
    } while(matches);


    output.forEach(match => {
        if(match){
            _.set(frontmatter, match[1].trim(), match[2].trim());
        }
    });

    if(!frontmatter) {
        createNotice("No frontmatter found in note", true);
        return;
    }

    const frontMatterMapping = getFrontMatterMapping(frontmatter);
    //Use the mapping to resolve the values to the selected event details
    for(const [key, value] of Object.entries(frontMatterMapping)) {        
        const eventValue = _.get(frontmatter, key, null)
        if(eventValue){
            _.set(frontmatter, value, eventValue);
        }
    }
    const calendars = await googleListCalendars();
    const frontmatterPosition = frontmatter.position;
    delete frontmatter.position;
    const calendar = calendars.find(calendar => calendar.id == (frontmatter.calendar ?? plugin.settings.defaultCalendar) || calendar.summary  == (frontmatter.calendar ?? plugin.settings.defaultCalendar));
   
    if(!calendar){
        createNotice("Event not created. Calendar not defined. Set a default calendar in the settings or set the field calendar");
        return;
    }
    frontmatter.parent = calendar;

    //Check for a summary if there is none defined

    if(!frontmatter.summary) {
        frontmatter.summary = view.file.basename;
    }
    

    if(frontmatter.description){

        if(typeof frontmatter.description == "string") {

            //Special Replacements for description
            if(frontmatter.description?.toLowerCase() == "header"){
                frontmatter.description = '';
            
                const headers = app?.metadataCache?.getFileCache(view.file).headings
                headers.forEach(header => {
                    frontmatter.description +=  `<h${header.level}>${header.heading}</h${header.level}>`
                });
            }

            if(frontmatter.description?.toLowerCase() == "file") {
                //Remove frontmatter before html conversion
                const html = marked.parse(fileContent.substring(frontmatterPosition.end.offset));
                frontmatter.description = html;
            }
        }else if(typeof frontmatter.description == "object") {
           
            const headers = app?.metadataCache?.getFileCache(view.file).headings

            const contentList = frontmatter.description.map(index => {
               
                if(index >= headers.length){
                    return -1;
                }
                if(index + 1 < headers.length){
                    return fileContent.substring(headers[index].position.start.offset, headers[index+1].position.start.offset - 1);
                }else {
                    return fileContent.substring(headers[index].position.start.offset, fileContent.length);
                }
            })

            console.log(contentList);

            if(contentList.contains(-1)){
                createNotice("Event not created.A Header in the headerlist is out of range", true);
                return;
            }
            const html = marked.parse(contentList.join("\n"));
            frontmatter.description = html;
        }
    }




    //Check for start and end date if there is none defined
    if(!frontmatter.start && !frontmatter.startTime){
        frontmatter.start = {date: window.moment()}
    }
    if(!frontmatter.end && !frontmatter.endTime){
        frontmatter.end = frontmatter.start
    }
    
    if(frontmatter.start.date){
        frontmatter.start.date = window.moment(frontmatter.start.date).format("YYYY-MM-DD");
        frontmatter.end.date = window.moment(frontmatter.end.date).clone().add(1,"day").format("YYYY-MM-DD"); 
    }else{
        frontmatter.start.dateTime = window.moment(frontmatter.start.dateTime).format();
        frontmatter.end.dateTime = window.moment(frontmatter.end.dateTime).format(); 
    }


    //Special replacement for recurrence
    if(frontmatter.recurrence) {
        try{
            const rule = RRule.fromText(frontmatter.recurrence);
            const ruleSet = new RRuleSet()
            ruleSet.rrule(rule);
            frontmatter.recurrence = ruleSet.valueOf();
        }catch(err) {
            createNotice("Event not created. Error in recurrence text.", true)
            return;
        }
    }

    return frontmatter;
}

const getFrontMatterMapping = (frontmatter:FrontMatterCache): Map<string, string> => {

    const mapping = new Map<string, string>();

    //Allow loading mapping data from another file 
    if(typeof frontmatter.mapping == "string") {
        if(!frontmatter.mapping.endsWith(".md")){
            frontmatter.mapping += ".md"
        }
        const newPath = normalizePath(frontmatter.mapping);
        const file = app.vault.getAbstractFileByPath(newPath) as TFile;

        if(!file){
            createNotice(`Mapping Error, file "${newPath}" not found.`);
            return mapping
        }

        frontmatter = app?.metadataCache?.getFileCache(file).frontmatter;
        if(!frontmatter){
            createNotice(`Mapping Error, file "${newPath}" does not contain frontmatter.`);
            return mapping;
        }
    }
    
    //Return no mapping if there in none provided
    if(!frontmatter.mapping) {
        return mapping;
    }
    
    return frontmatter.mapping;
}