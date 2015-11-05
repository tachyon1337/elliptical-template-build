
var gulp=require('gulp'),
    gulputil=require('gulp-util'),
    path=require('path'),
    fs = require('fs-extra'),
    concat=require('gulp-concat'),
    http = require('http'),
    uglify = require('gulp-uglify'),
    dust=require('dustjs-elliptical'),
    tap=require('gulp-tap'),
    merge = require('merge-stream');



/*
    dustjs template compilation api module
    exposes compile as a public method

    opts: {Array} opts.src-->array of source paths to compile
          {Array} opts.fragmentsSrc--->array of source paths of non-html files to compile inner html element fragments only
          {String} opts.dest--> dest root output path
          <optional> {Object} opts.$provider ---> data(redis or memory) store provider to save templates to a store. Must implement (i) flushModel (ii) mset
          <optional> {String} opts.model --> model class associated with template documents...default='template'

*/
exports.compile=function(opts){
    var fragmentsFile='fragments.js';
    var templatesFile='templatefiles.js';
    var compiledFile='templates.js';
    var fragmentArray=[];
    var templateArray=[];
    var namespace=null;


    var $store=null;
    var model;
    var saveToStore=false;
    if(opts.$provider !==undefined){
        saveToStore=true;
        $store=opts.$provider;
    }

    var srcPaths=opts.src;
    var srcFragmentPaths=opts.fragmentsSrc;
    srcFragmentPaths=(srcFragmentPaths===undefined) ? srcPaths : srcPaths.concat(srcFragmentPaths);
    var destPath=opts.dest;
    var fragmentFilePath=destPath + '/' + fragmentsFile;

    //
    /**
     * internal execution method
     * @private
     */
    function compile_(){
        console.log('compiling templates');
        var templates= compileTemplates(srcPaths);
        var fragments=compileFragments(srcFragmentPaths);

        var write=write_([destPath + '/' + templatesFile,destPath + '/' + fragmentsFile]);

        return merge(templates,fragments);

    }

    /* call the method */
    compile_();


    /**
     * get the template stream
     * @returns {Stream}
     */
    function getTemplateStream(src){
        return gulp.src(src);
    }



    /**
     * parses templates for client-side fragments, which are written to a temp file
     *
     * @returns {*}
     */
    function templateParser(src){
        fragmentArray.length=0;
        var result;
        return getTemplateStream(src)
            .pipe(tap(function(file) {
                var buffer=file.contents.toString().replace(/\r\n|\r|\n|\t/g, '');
                result=buffer.match(/<ui-template(.*?)<\/ui-template>/g);
                if(result && result.length > 0){
                    result.forEach(function(s){
                        var o={};
                        var id= s.match(/id="([^"]*)"/);
                        o.id=(id && id.length>0) ? id[1] : null;
                        //implementation of name? TODO
                        //var name= s.match(/name="([^"]*)"/);
                        //o.name=(name && name.length>0) ? name[1] : null;
                        if(o.id){
                            o.fragment=s;
                            fragmentArray.push(o);
                        }

                    });
                }
                result=buffer.match(/<form(.*?)<\/form>/g);
                if(result && result.length > 0){
                    result.forEach(function(s){
                        var o={};
                        var id= s.match(/id="([^"]*)"/);
                        o.id=(id && id.length>0) ? id[1] : null;
                        //implementation of name? TODO
                        //var name= s.match(/name="([^"]*)"/);
                        //o.name=(name && name.length>0) ? name[1] : null;
                        if(o.id){
                            o.fragment=s;
                            fragmentArray.push(o);
                        }

                    });
                }
            }))
            .pipe(concat(fragmentsFile));

    }


    function compileTemplates(src){
        return getTemplateStream(src)
            .pipe(tap(function(file){
                var name=path.basename(file.relative,'.html');
                var buffer=file.contents.toString().replace(/\r\n|\r|\n|\t/g, '');
                buffer=buffer.replace(/<template>/g,'').replace(/<\/template>/g,'');
                var compiled_=dust.compile(buffer,name,false);
                file.contents = new Buffer(compiled_);
                if(saveToStore){
                    addTemplateToArray(compiled_,name);
                }
            }))
            .pipe(concat(templatesFile))
            .pipe(gulp.dest(destPath));
    }

    function compileFragments(src){
        return templateParser(src)
            .pipe(tap(function(file){
                console.log('compiling fragments');
                var src='';
                if(fragmentArray && fragmentArray.length > 0){
                    fragmentArray.forEach(function(obj){
                        var fragment=obj.fragment;
                        //var name=(obj.id) ? obj.id : obj.name;
                        var name=obj.id;
                        src=src + dust.compile(fragment,name,false);
                    })
                }

                var fragArrayJSObject='window.$$=window.$$ || {};window.$$.fragments=' + JSON.stringify(fragmentArray) + ';';
                src=src + '\n\n' + fragArrayJSObject;
                fs.writeFileSync(fragmentFilePath,src);
            }))

    }

    function write_(src){
       gulp.src(src)
            .pipe(concat(compiledFile))
            .pipe(gulp.dest(destPath));
    }

    function save_(){
        if(saveToStore){
            saveTemplates();
        }
    }

    function addTemplateToArray(template,name){
        var strTemplate=JSON.stringify(template);
        name=(namespace) ? namespace + name : name;
        templateArray.push(name,strTemplate);

    }

    /* cleanup files */
    function cleanUp(arr){
        console.log('cleaning up');
        if(arr.length && arr.length > 0){
            arr.forEach(function(s){
                fs.removeSync(destPath + '/' + s);
            });
        }

    }

    function saveTemplates(){
        console.log('deleting current template store cache...');
        $store.flushModel(model,function(err,data){
            if(!err){
                $store.mset(templateArray,model,function(err,data){
                    if(err){
                        console.log('error saving templates: ' + err.message);
                        process.exit(0);
                    }else{
                        console.log('templates saved...');
                    }
                });
            }
        });
    }
};

function getRootPath(appDirectory){
    return (process.env.NODE_ENV != 'production') ? process.cwd() + '/' + appDirectory : process.cwd();
}