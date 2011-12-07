var debug = require('debug')('dash-appmanager'),
    fs = require('fs'),
    path = require('path'),
    nano = require('nano'),
    exec = require('child_process').exec,
    formaline = require('formaline'),
    _ = require('underscore'),
    formalineOpts = {
        // logging: 'debug:on,1:on,2:on,3:off,4:off,console:on,file:off,record:off'
    },
    viewsPath = path.resolve(__dirname, '../../views'),
    _uploadsPath,
    _activeApps = {},
    _messenger;
    
function _copyFiles(files, callback) {
    files.forEach(function(file) {
        var fileData = file.value[0],
            targetPath = path.join(_uploadsPath, fileData.name);
        
        // TODO: copy these in a more cross-platform friendly way
        exec('mv ' + fileData.path + ' ' + targetPath, callback);
    });
}

function _getApps(req, page, callback) {
    callback({
        apps: _activeApps
    });
} // _getApps

function _handleApp(appData) {
    if (appData.id) {
        _activeApps[appData.id] = appData;
    }
} // _handleApp

function _handleClearApps() {
    debug('received clearapps request');
    _activeApps = {};
} // _handleClearApps

function _makeDeleteHandler(config, dash) {
    // get the couch url
    var couchurl = config.couchurl,
        db;
    
    if (config.admin) {
        couchurl = config.admin.couchurl || couchurl;
    }
    
    // initialise the mesh db connection
    debug('initialized delete handler, pointing to: ' + couchurl + '/' + config.meshdb);
    db = nano(couchurl).use(config.meshdb);
    
    function deleteAppFiles(appid, callback) {
        var appPath = path.resolve(dash.serverPath, 'lib/apps/' + appid);
        
        debug('checking for application files in: ' + appPath);
        path.exists(appPath, function(exists) {
            if (! exists) {
                callback();
            }
            else {
                debug('deleting application files in path: ' + appPath);
                exec('rm -r ' + appPath, callback);
            }
        });
    } // deleteAppFiles
    
    return function(req, res, next) {
        var appid = req.param('id');
        
        debug('received delete request for app: ' + appid);
        deleteAppFiles(appid, function() {
            // TODO: delete dashboard plugins 
            
            db.get('app::' + appid, function(err, doc) {
                if (! err) {
                    debug('doc exists, rev id = ', doc._rev);

                    db.destroy('app::' + appid, doc._rev, function(err, doc) {
                        debug('delete response: ', err, doc);
                        res.redirect('/apps/list');
                    });
                }
                else {
                    res.redirect('/apps/list');
                }
            });
        });
    };
} // _makeDeleteHandler
    
function _makeUploadHandler(config, dash) {
    return function(req, res, next) {
        var form = new formaline(formalineOpts);
        
        // formaline not compatible with the body parser...
        delete req.body;
        
        form.on('loadend', function(data, res, cback) {
            debug('upload complete');
            _copyFiles(data.files, next);
        });
        
        form.on('error', function(err) {
            debug('error uploading form', err);
            next();
        });
        
        debug('captured upload request');
        form.parse(req, res, next);
    };
} // _makeUploadHandler
    
exports.connect = function(server, config, dash, callback) {
    var navItems = [
        { url: '/apps/list', title: 'List' },
        { url: '/apps/upload', title: 'Upload' }
    ];
    
    server.post('/apps/upload', _makeUploadHandler(config, dash));
    server.get('/apps/delete/:id', _makeDeleteHandler(config, dash));
    
    _uploadsPath = path.join(dash.assetsPath, 'uploads');
    
    // reset the active apps
    _activeApps = _.extend({}, dash.apps);

    // add message listeners
    dash.messenger.on('app', _handleApp);
    dash.messenger.on('clearApps', _handleClearApps);
    
    // set the upload path
    callback({
        loaders: {
            'apps/list': _getApps
        },
        
        nav: [
            { url: '/apps', title: 'Apps', items: navItems }
        ],

        views: {
            'apps/list': path.join(viewsPath, 'list.html'),
            'apps/upload': path.join(viewsPath, 'upload.html')
        }
    });
};

exports.drop = function(server, config, dash) {
    server.remove('/apps/delete/:id');
    server.remove('/apps/upload');
    
    // cleanup messenger listeners
    dash.messenger.removeListener('app', _handleApp);
    dash.messenger.removeListener('clearapps', _handleClearApps);
    
    return [
        { action: 'dropLoader', loader: 'apps/list' },
        { action: 'removeNav', url: '/apps' },
        { action: 'dropView', view: 'apps/list' },
        { action: 'dropView', view: 'apps/upload' }
    ];
};