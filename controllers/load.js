var express = require('express');
var router = express.Router();
var express = require('express');
var ogr2ogr = require("ogr2ogr");
var pg = require("pg");

router.use(function(req, res, next) {
	if (!req.isAuthenticated()) { 
		console.log("redirecting");
		//res.redirect('/login');
		res.status(404);
		return; 
	}

	next();
});
/*
router.get('/',  function(req, res){
	console.log(req.query);
	// return;
	// if(!req.query){
	res.render('load', {
		user : req.user,
		tableName: req.query.tableName,
		type:req.query.type||'',
		stype:req.query.stype||''
	});
	return;
	// }
});
*/
router.get('/:pid',  function(req, res){
	//res.writeHead(200, {"Content-Type": "application/json"});
	var fileName=req.query.fileName;
	if(!fileName){
		fileName = req.query.fileName;
		if(!fileName){
			res.json({"err":"Tablename missing in request!"});
			return;
		}
	}
	var tableName=req.query.tableName?req.query.tableName.replace(/\W/g, '').toLowerCase():null;
	var pid=parseInt(req.params.pid);
	res.setTimeout(0); 
	if(req.query.step == 1){
		getOgrInfo(req,res,pid,fileName);
	}
	// step two: load into database. OBJ! must have a schema created in the
	// database for the user, ex: create schema userShortName;
	else if(req.query.step == 2) {
		execOgr2ogr(req,res,pid,fileName,tableName);
	}
	else if(req.query.step == 3) {
		cleanTable(req,res,pid,fileName,tableName);
	}
	// step four: load into database
	else if(req.query.step == 4) {
		createSoilsTable(req,res,pid,fileName,tableName);
	}
	// step five: load into database
	else if(req.query.step == 5) {
		createStatsTable(req,res,pid,fileName,tableName);
	}
});

function getOgrInfo(req,res,pid,fileName){
	var filePath=__dirname + "/../public/files/" + req.user.shortName + "/" + pid + '/' + fileName;
	var fs = require('fs');
	// make user upload folder if it doesn't exist
	if(!fs.existsSync(__dirname + "/../public/files/" + req.user.shortName + "/" + pid))
	{
		fs.mkdirSync(__dirname + "/../public/files/" + req.user.shortName + "/" + pid);
	}
	var ogr = ogr2ogr( filePath);

	if (!fs.existsSync(filePath)) {
		console.log("File doesn't exist");
		res.json({"err":"Filename "+fileName+" not found!"});
		return;
	}

	ogr.info(function (er, data) {
		if (er){ 
			console.error(er);
			res.status(404).json({err:er});
			return;
		}
		// console.log(data)
		console.log("Layer name: " + data["Layer name"]);
		data["Layer name"] = data["Layer name"].replace(/\W/g, '').toLowerCase();
		try{
			data['file']=data['file'].split("'")[1].split("`")[1];
			data['file'].replace(/Open/,"ESRI ");
		}catch(e){}

		if(data.Geometry=='None'){
			loadNonSpatial(req,res,fileName,filePath,pid,data);
		}
		else{ 
			pg.connect(global.conString,function(err, client, release) {
				if (err){ res.json({"err":"No connection to database;"});throw err;}
				//"delete from "+req.user.shortName+".tables where name='"+data['Layer name']+"'"
				var sql="insert into "+req.user.shortName+".tables(name,filename,pid,type,geometrytype,filetype,date_loaded) values('"+data['Layer name']+"', "+pid+","+ (req.query.subj?"1":"0") +",'"+data['Geometry']+"','" + data['file'] + "',NOW())"
				console.log(sql);
				client.query(sql, function(err, result) {
					release()
					// res.json(msg));
					res.json(data);
				});
			})
		}
	});
}

function execOgr2ogr(req,res,pid,fileName,tableName){
	var filePath=__dirname + "/../public/files/" + req.user.shortName + "/"+ pid + "/" + fileName ;

	console.log("Loading "+fileName+" into database");
	var fs = require('fs');

	if (!fs.existsSync(filePath)) {
		console.log("File doesn't exist");
		res.end(JSON.stringify({"err":"File "+fileName+" not found!."}));
		return;
	}
	if(/^win/.test(process.platform))
		process.env['GDAL_DATA'] = 'C:\\PostgreSQL93\\gdal-data';
	var step=2;
	// is it not a spatial file?
	var opts=["-t_srs","epsg:3857","-overwrite","-lco", "DROP_TABLE=IF_EXISTS", "-lco", "WRITE_EWKT_GEOM=ON", "-nlt", "MULTIPOLYGON", "-nln",tableName];

	var ogr = ogr2ogr( filePath)
	.format('PostgreSQL') 
	.options(opts)//
	.skipfailures()  
	.destination(global.ogrConnString + ' active_schema='+req.user.shortName) 	
	.exec(function (er, data) {
		console.log("Done");
		if (er) console.error(er)
		// console.log(data.toString())
		// res.end(data.toString());
		var msg={"step":step,"ret":data?data.toString():""};
		if(er)msg['err']="Unable to load table:  "+er;
		// shouldn't ever be called since handled in upload.js
		res.json(msg);
	});
}

//step three: load into database
function cleanTable(req,res,pid,fileName,tableName) {
	var baseTableName = tableName;
	tableName = req.user.shortName+"."+baseTableName;
	pg.connect(global.conString,function(err, client, release) {
		if (err){ res.json({"err":"No connection to database;"});throw err;}

		// strip off extension
		// fileName = fileName.split(".")[0];
		/*
		 * var sql= [ client.query.bind(client, 'update '+tableName+' set
		 * wkb_geometry=st_cleangeometry(wkb_geometry)'),
		 * client.query.bind(client, 'alter table '+tableName+' drop column
		 * if exists _acres_total'), client.query.bind(client, 'alter table
		 * '+tableName+' add _acres_total double precision'),
		 * client.query.bind(client, 'alter table '+tableName+' rename
		 * column ogc_fid to _fid'), client.query.bind(client, 'update
		 * '+tableName+' set _acres_total=ST_Area(wkb_geometry)/4046.86'),
		 * client.query.bind(client, "select column_name FROM
		 * information_schema.columns WHERE table_name='"+tableName+"'") ];
		 */
		var sql=
			[
			 'update '+tableName+' set wkb_geometry=st_cleangeometry(wkb_geometry)',
			 'alter table '+tableName+' rename column ogc_fid to oid',		 
			 //"select column_name FROM information_schema.columns WHERE table_name='"+baseTableName+"' and table_schema='"+req.user.shortName+"'",
			 'drop table if exists ' + tableName + '_vars',
			 // "create table " + tableName + "_vars as select 1
			 // as include,0 as id,0 as depvar,column_name as
			 // name from information_schema.columns where
			 // table_schema='"+req.user.shortName+"' and
			 // table_name = '"+baseTableName+"_stats' and
			 // column_name not
			 // in('wkb_geometry','shape_leng','shape_area','_acres_total')
			 // and data_type in('numeric','double
			 // precision','float','integer','decimal')",
			 "create table " + tableName + "_vars as select 1 as include,1 as cinclude,0 as id,0 as uniqueid,0 as depvar,column_name as name,data_type as type from information_schema.columns where table_schema='"+req.user.shortName+"' and table_name = '"+baseTableName+"' and column_name not in('wkb_geometry','shape_leng','shape_area','_acres_total')",// and
			 // data_type
			 // in('numeric','double
			 // precision','float','integer','decimal')",
			 // string fields can't be used as dependent
			 // variables
			 "update " + tableName + "_vars set include=2,depvar=2 where type not in('numeric','double precision','float','integer','decimal')",
			 // set the oid as the default unique identifier
			 "update " + tableName + "_vars set include=3,id=1 where name='oid'",
			 // set the first numeric field found as the
			 // dependent variable
			 "update " + tableName + "_vars set depvar=1 where name=(select name from "+tableName+"_vars where include=1 limit 1)",
			 // find all the fields that have all distinct/unique
			 // values. These are the only fields that can be
			 // used as unique identifiers
			 "select public.update_unique('"+req.user.shortName+"','" + baseTableName + "')",
			 // remove the non-numeric fields that don't have all
			 // unique values
			 "delete from "+ tableName + "_vars where include=2 and uniqueid=0",
			 //do this after creating the _vars table
			 'alter table '+tableName+' drop column if exists _acres_total',
			 'alter table '+tableName+' add _acres_total double precision',
			 // _fid',
			 'update '+tableName+' set _acres_total=ST_Area(wkb_geometry)/4046.86',
			 
			 "select name from " + tableName + "_vars where uniqueid=1"
			 ];
		/*
		 * var obj={"step":3}; async.eachSeries(sql, function (item,
		 * callback){ console.log(item); // print the key client.query(item,
		 * function(err, result) { if(result.rows &&
		 * result.rows[0]["column_name"]){
		 * obj["id"]=result.rows[2]['column_name']; obj["rows"]=result.rows; }
		 * callback(); // tell async that the iterator has completed },
		 * function(err) { release(); console.log('iterating done'); //var
		 * obj={"step":3,"id":result.rows[2]['column_name'],"rows":result.rows};
		 * if (err) obj['err']=err; res.end(JSON.stringify(obj)); }); });
		 */
		// console.log(sql);

		// async.series(sql, function (err, results) {
		// console.log(results.rows);
		/*
		 * for (var i in results) { if(results[i].rows) for (var j in
		 * results[i].rows) { console.log(results[i].rows[j]); } }
		 */


		// });
		// release();

		console.log(sql);
		client.query(sql.join(";"), function(err, result) {
			release()
			// if (err) throw err;
			// console.log("Count: "+result.rows[0])

			var obj={"step":3,"id":result&&result.rows?result.rows:null};
			if (err) {obj['err']=err.toString();console.log(err);}
			// res.writeHead(200, {"Content-Type": "application/json"});
			res.json(obj);
		})

	})	  	
}

function createSoilsTable(req,res,pid,fileName,tableName){
	var idName = req.query.idName;
	if(!idName)idName='oid';
	else idName = idName.replace(/\W/g, '');
	var state="select state from "+req.user.shortName + ".projects where id=$1";
	tableName = req.user.shortName + "." + tableName;
	var vals=[pid];
	pg.connect(global.conString,function(err, client, release) {
		if (err){ res.json({"err":"No connection to database;"});throw err;}
		// client.query("BEGIN");
		// strip off extension
		client.query(state,vals, function(err, result) {
			if (err){ res.json({"err":"State not found for this project;"});throw err;}
			var state_abbr=result.rows[0].state;
			// fileName = fileName.split(".")[0];
			var sql=
				[
				 // "begin",
				 "drop table if exists "+tableName+"_soils",
				 "CREATE TABLE "+tableName+"_soils AS ("
				 +" SELECT part_2."+idName+",part_2._acres_total,part_1.areasymbol, part_1.spatialver, part_1.musym, part_1.mukey ,ST_Intersection(part_1.wkb_geometry, part_2.wkb_geometry) as wkb_geometry"	  
				 +" FROM "+state_abbr+".mupolygon AS part_1, "+tableName+" AS part_2"
				 +" WHERE ST_Intersects(part_1.wkb_geometry, part_2.wkb_geometry))",
				 "alter table "+tableName+"_soils add _acres_pct double precision",
				 'alter table '+tableName+'_soils drop column if exists oid',
				 "alter table "+tableName+"_soils add oid serial",
				 "update "+tableName+"_soils set _acres_pct = (ST_Area(wkb_geometry)/4046.86)/_acres_total",
				 // "commit",
				 "select count(*) as count from "+tableName+"_soils"
				 ];
			console.log(sql);
			// client.query("BEGIN");
			// strip off extension
			client.query(sql.join(";"), function(err, result) {
				release()
				// console.log(result.rows[0])
				var obj={"step":4,"count":result&&result.rows?result.rows[0]['count']:0,"rows":result?result.rows:null};
				if (err) {obj['err']=err.toString();console.log(err);}
				// res.writeHead(200, {"Content-Type": "application/json"});
				res.json(obj);
			})
		});
	})	  

}
function createStatsTable(req,res,pid,fileName,tableName){
	var baseTableName = tableName;
	tableName = req.user.shortName + "." + tableName;

	var idName = req.query.idName;
	if(!idName)idName='oid';
	else idName=idName.replace(/\W/g, '');
	var state="select state from "+req.user.shortName + ".projects where id="+pid;
	pg.connect(global.conString,function(err, client, release) {
		if (err){ res.end(JSON.stringify({"err":"No connection to database;"}));throw err;}
		// client.query("BEGIN");
		// strip off extension
		client.query(state, function(err, result) {
			if (err){ res.json({"err":"State not found for this project;"});throw err;}
			var state_abbr=result.rows[0].state;

			// fileName = fileName.split(".")[0];
			var sql=
				[
				 // "begin",
				 // "Slope","Elevation","Prod Index","Range
				 // Potential","Drought Index","All Crop Prod Index"
				 "drop table if exists "+tableName+"_stats",
				 "create table "+tableName+"_stats as "
				 +' SELECT d.*,s.* FROM('
				 // +"acres_/total_aums,"
				 + ' select '+idName+" as "+idName+"_tmp"
				 + ' ,sum(c.slope_r*_acres_pct) as "Slope"'
				 + ' ,avg(c.elev_r) as "Elevation"'
				 + ' ,avg(c.rsprod_r) as "Range Forage"'
				 // + ' ,avg(c.reannualprecip_r) as "REAP" '
				 + ' ,avg(c.airtempa_r) as "Air temperature"'
				 + ' ,avg(c.ffd_r) as "Frost free days"'
				 + ' ,avg(c.initsub_r) as "Init Subsidence"'
				 + ' ,avg(c.totalsub_r) as "Total Subsidence"'
				 + ' ,avg(c.map_l) as "Average precipitation"'
				 + ' ,sum( (((10-c.nirrcapcl::int)+1)*10)*_acres_pct) as "Prod Index"'
				 + " ,sum(case when c.wlrangeland='Fair' then _acres_pct*3 when c.wlrangeland='Poor' then _acres_pct*2 when c.wlrangeland='Very Poor' then _acres_pct else 0 end) as \"Range Potential\""
				 + ' ,sum(v.droughty * _acres_pct) as "Drought Index"'
				 + ' ,sum(v.nccpi2all * _acres_pct) as "All Crop Prod Index"'
				 + " from " + tableName+"_soils h,"
				 + " "+state_abbr+".component c, "+state_abbr+".muaggatt m, "+state_abbr+".valu1 v"
				 + " where h.mukey=c.mukey"
				 + " and m.mukey=c.mukey"
				 + " and v.mukey=c.mukey"
				 + ' group by ' + idName
				 + ') s JOIN '+tableName+' d'
				 + ' ON s.'+idName+'_tmp=d.'+idName
				 + ' order by d.'+idName,
				 // "commit",

				 'alter table '+tableName+'_stats drop column if exists ogc_fid',
				 'alter table '+tableName+'_stats drop column if exists wkb_geometry',
				 'alter table '+tableName+'_stats drop column if exists oid',
				 'alter table '+tableName+'_stats drop column if exists '+idName+'_tmp',
				 'alter table '+tableName+'_stats add column oid serial',

				 'select count(*) as count from '+tableName+'_stats'];

			// +"inner join "+tableName+"_soils
			// on("+tableName+"_soils.allot_name=(graz_bid.range_unit,',',''))"
			// +"group by
			// range_unit,beg_date,bid_total,total_aums,bid_aum,year,gis_acres"
			// +"order by beg_date,range_unit",
			// "select count(*) from "+tableName+"_stats"

			console.log(sql);
			// strip off extension
			client.query(sql.join(";"), function(err, result) {
				release()
				// if (err) throw err;
				// console.log(result.rows[0])
				var obj={"step":5,"count":result&&result.rows?result.rows[0]['count']:0,"rows":result?result.rows:null};
				if (err) {obj['err']=err.toString();console.log(err);}
				// res.writeHead(200, {"Content-Type":
				// "application/json"});
				res.json(obj);
			})
		})
	});

}

/*
 * Verify file upload.
 */
function loadNonSpatial(req,res,fileName,filePath,pid,data){
	if(/^win/.test(process.platform))
		process.env['GDAL_DATA'] = 'C:\\PostgreSQL93\\gdal-data';
	var tableName = data["Layer name"].replace(/\W/g, '').toLowerCase();
	// is it not a spatial file?
	var opts=["-overwrite","-lco", "DROP_TABLE=IF_EXISTS","-nln",tableName];
	// var f = tableName.toLowerCase().split(".");
	var isCSV = fileName.substring(fileName.length-3)!='dbf';
	console.log("isCSV: " +  isCSV);
	/*
	 * if(f.length>1){ if(
	 * (f[f.length-1]=='xls'||f[f.length-1]=='csv'||f[f.length-1]=='dbf'||f[f.length-1]=='xlsx')){
	 * isCSV=f[f.length-1]!='dbf'; tableName = tableName.split(".")[0]; } }
	 */
	var ogr = ogr2ogr( filePath)
	.format('PostgreSQL') 
	.options(opts)//
	.skipfailures()  
	.destination(global.ogrConnString + ' active_schema='+req.user.shortName) 	
	.exec(function (er, ret) {
		console.log("Ogr2Ogr finished");
		if (er){
			console.error(er)
			res.status(404).json({err:er});
			return;
		}
		// console.log(data.toString())
		// res.end(data.toString());
		// var msg={"step":step,"ret":data?JSON.stringify(data):""};
		// if(er)msg['err']="Unable to load table: "+er;
		convertCSV2Numeric(fileName,tableName,data,pid,req,res,isCSV);
	});

}

function convertCSV2Numeric(fileName,tableName,data,pid,req,res,isCSV)
{
	var baseTableName=tableName;
	var sql="select column_name from information_schema.columns where table_schema='"+req.user.shortName+"' and table_name = '"+tableName+"' and column_name not in('ogc_fid','wkb_geometry','id','shape_leng','shape_area','_acres_total') and data_type not in('numeric','double precision','float','integer','decimal')";
	console.log(sql);
	pg.connect(global.conString,function(err, client, release) {
		if (err){ res.json({"err":"No connection to database;"});throw err;}
		// strip off extension
		client.query(sql, function(err, result) {
			// add the schema to the tablename
			tableName = req.user.shortName+"."+ tableName;
			var cols=[];
			//console.log(result.rows);
			for(var i in result.rows){
				if(result.rows[i].column_name.charAt(0) == result.rows[i].column_name.charAt(0).toUpperCase())
					result.rows[i].column_name='"' + result.rows[i].column_name + '"';
				else if(result.rows[i].column_name.indexOf(" ")!=-1)
					result.rows[i].column_name='"' + result.rows[i].column_name + '"';

				cols.push(result.rows[i].column_name);
				// cols.push("tonumeric('"+result.rows[i].column_name +
				// ','"+tableName+"'))";
			}
			// var sql='select '+corr.join(",")+' from '+tableName+"_stats";
			var sql = [
			           (isCSV?"select public.tonumeric('" + cols.join("','"+tableName+"'),public.tonumeric('") + "','"+tableName+"')":"select 1")
			           ,'drop table if exists ' + tableName + "_stats"
			           ,"create table " + tableName+"_stats as select * from " + tableName
			           ,"alter table " + tableName + "_stats drop if exists wkb_geometry"
			           ,"alter table " + tableName + "_stats drop if exists ogc_fid"
			           ,"alter table " + tableName + "_stats add oid serial"
					   //,"delete from "+req.user.shortName+".tables where name='"+baseTableName+"'"
					   ,"insert into "+req.user.shortName+".tables(name,filename,pid,type,geometrytype,filetype,date_loaded) values('"+baseTableName + "','"+fileName+"',"+pid+","+(req.query.subj?"1":"0") +",'"+data['Geometry']+"','" + data['file'] + "',NOW())"
			           ,'drop table if exists ' + tableName + '_vars'
			           // "create table " + tableName + "_vars as select 1 as
			           // include,0 as id,0 as depvar,column_name as name from
			           // information_schema.columns where
			           // table_schema='"+req.user.shortName+"' and table_name
			           // = '"+baseTableName+"_stats' and column_name not
			           // in('wkb_geometry','shape_leng','shape_area','_acres_total')
			           // and data_type in('numeric','double
			           // precision','float','integer','decimal')",
			           ,"create table " + tableName + "_vars as select 1 as include,0 as id,0 as uniqueid,0 as depvar,column_name as name,data_type as type from information_schema.columns where table_schema='"+req.user.shortName+"' and table_name = '"+baseTableName+"_stats' and column_name not in('wkb_geometry','shape_leng','shape_area','_acres_total')" // and
			           // data_type
			           // in('numeric','double
			           // precision','float','integer','decimal')",
			           // string fields can't be used as dependent variables
			           ,"update " + tableName + "_vars set include=2,depvar=2 where type not in('numeric','double precision','float','integer','decimal')"
			           // set the oid as the default unique identifier
			           ,"update " + tableName + "_vars set include=3,id=1 where name='oid'"
			           // set the first numeric field found as the dependent
			           // variable
			           ,"update " + tableName + "_vars set depvar=1 where name=(select name from "+tableName+"_vars where include=1 limit 1)"
			           // find all the fields that have all distinct/unique
			           // values. These are the only fields that can be used as
			           // unique identifiers
			           ,"select public.update_unique('"+req.user.shortName+"','" + baseTableName + "')"
			           // remove the non-numeric fields that don't have all
			           // unique values
			           ,"delete from "+ tableName + "_vars where include=2 and uniqueid=0"
			           ,'select count(*) as count from '+tableName+'_stats'];

			// ,'drop table if exists ' + tableName + '_vars'
			// ,"create table " + tableName + "_vars as select 1 as include,0 as
			// id,0 as depvar,column_name as name from
			// information_schema.columns where table_schema='"+shortName+"' and
			// table_name = '"+baseTableName+"_stats' and column_name not
			// in('wkb_geometry','shape_leng','shape_area','_acres_total') and
			// data_type in('numeric','double
			// precision','float','integer','decimal')"


			console.log(sql);
			client.query(sql.join(";"), function(err, result) {
				release()
				console.log(res.headersSent);
				if(res.headersSent)res.end(JSON.stringify(data));
				else
					res.json(data);
			});
		})
	})
}
module.exports = router;