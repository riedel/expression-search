// Original by Ken Mixter for GMailUI, which is "GMailUI is completely free to use as you wish."
// Opera Wang, 2010/1/15
// GPL V3 / MPL

if ( 'undefined' == typeof(ExpressionSearchChrome) ) {
    var ExpressionSearchChrome = {
      isInited:0,

      // request to create virtual folder
      latchQSFolderReq: 0,
      
      // if last key is Enter
      isEnter: 0,
      
      // preference object
      perfs: null,

      init: function() {
        try {
          if ( this.isInited == 0 ) {
            ExpressionSearchLog.log("Expression Search: init...");
            this.importModules();
            this.initPerf();
            this.initSearchInput();
            this.isInited = 1;
          } else {
            ExpressionSearchLog.log("Expression Search:Warning, init again");
          }
        } catch (err) {
          ExpressionSearchLog.logException(err);
        }
      },
      
      importModules: function() {
        this.Cu = Components.utils;
        this.Ci = Components.interfaces;
        //this.Cc = Components.classes;
        //this.Cr = Components.results;
        this.Cu.import("resource://expressionsearch/gmailuiParse.js");
        this.Cu.import("resource://app/modules/quickFilterManager.js");
        this.Cu.import("resource://app/modules/StringBundle.js");
        // for create quick search folder
        this.Cu.import("resource://app/modules/virtualFolderWrapper.js");
        this.Cu.import("resource://app/modules/iteratorUtils.jsm");
        // need to know whehter gloda enabled
        this.Cu.import("resource://app/modules/gloda/indexer.js");
        // to call gloda search, actually no need
        //Cu.import("resource://app/modules/gloda/msg_search.js");
      },
      
      initPerf: function() {
        this.prefs = Components.classes["@mozilla.org/preferences-service;1"]
             .getService(Components.interfaces.nsIPrefService)
             .getBranch("extensions.expressionsearch.");
        this.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        this.prefs.addObserver("", this, false);
        try {
          this.hide_normal_filer = this.prefs.getBoolPref("hide_normal_filer");
          this.hide_filter_label = this.prefs.getBoolPref("hide_filter_label");
          this.reuse_existing_folder = this.prefs.getBoolPref("reuse_existing_folder");
        } catch ( err ) {
          ExpressionSearchLog.logException(err);
        }
      },
      
      // get called when event occurs with our perf branch
      observe: function(subject, topic, data) {
        if (topic != "nsPref:changed") {
           return;
         }
         switch(data) {
           case "hide_normal_filer":
            this.hide_normal_filer = this.prefs.getBoolPref("hide_normal_filer");
            this.refreshFilterBar();
            break;
           case "hide_filter_label":
            this.hide_filter_label = this.prefs.getBoolPref("hide_filter_label");
            this.refreshFilterBar();
            break;
           case "reuse_existing_folder":
            this.reuse_existing_folder = this.prefs.getBoolPref("reuse_existing_folder");
            break;
         }
      },

      unregister: function() {
        ExpressionSearchChrome.prefs.removeObserver("", ExpressionSearchChrome);
        var aNode = document.getElementById(QuickFilterManager.textBoxDomId);
        if (aNode)
            aNode.removeEventListener("keypress", ExpressionSearchChrome.onSearchKeyPress, true);
        // remove our filter from the QuickFilterManager
        QuickFilterManager.killFilter('expression'); //Remove a filter from existence by name
        window.removeEventListener("unload", ExpressionSearchChrome.unregister, false);
      },
      
      refreshFilterBar: function() {
        let filterNode = document.getElementById('qfb-qs-textbox');
        if ( filterNode && filterNode.style ) {
          filterNode.style.display = this.hide_normal_filer ? 'none' : '';
        }
        let quickFilter = document.getElementById('qfb-filter-label');
        if ( quickFilter && quickFilter.style ) {
          quickFilter.style.display = this.hide_filter_label ? 'none' : '';
        }
        let spacer = document.getElementById('qfb-filter-bar-spacer');
        if ( spacer ) {
          spacer.flex = this.hide_filter_label ? 1 : 200;
        }
      },
      
      onSearchKeyPress: function(event){
        ExpressionSearchChrome.isEnter = 0;
        if ( event && ( ( event.DOM_VK_RETURN && event.keyCode==event.DOM_VK_RETURN ) || ( event.DOM_VK_ENTER && event.keyCode==event.DOM_VK_ENTER ) ) ) {
          ExpressionSearchChrome.isEnter = 1;
          let searchValue = this.value; // this is aNode/my search text box
          if ( typeof(searchValue) != 'undefined' && searchValue != '' ) {
            if ( GlodaIndexer.enabled && ( event.shiftKey || searchValue.toLowerCase().indexOf('g:') == 0 ) ) { // gloda
              searchValue = searchValue.replace(/^g:\s*/i,'');
              searchValue = searchValue.replace(/(?:^|\b)(?:from|f|to|t|subject|s|all|body|b|attachment|a|tag|label|l):/g,'').replace(/(?:\b|^)(?:and|or)(?:\b|$)/g,'').replace(/[()]/g,'')
              if ( searchValue != '' ) {
                //this._fireCommand(this); // just for selection, but no use as TB will unselect it
                let tabmail = aDocument.getElementById("tabmail");
                tabmail.openTab("glodaFacet", {
                  searcher: new GlodaMsgSearcher(null, searchValue)
                });
              }
            } else if ( event.ctrlKey || event.metaKey ) { // create quick search folder
              ExpressionSearchChrome.latchQSFolderReq = 1;
              this._fireCommand(this);
            } else {
              ExpressionSearchChrome.isEnter = 0; // showCalculationResult also will select the result.
              var e = compute_expression(searchValue);
              if (e.kind == 'spec' && e.tok == 'calc') {
                ExpressionSearchChrome.showCalculationResult(e);
              }
            }
          }
        } // end of IsEnter
        // -- Keypresses for focus transferral
        if ( event && event.DOM_VK_DOWN && ( event.keyCode == event.DOM_VK_DOWN ) ) {
          let threadPane = aDocument.getElementById("threadTree");
          // focusing does not actually select the row...
          threadPane.focus();
          // ...so explicitly select the current index.
          threadPane.view.selection.select(threadPane.currentIndex);
          return false;
        }
      },

      initSearchInput: function() {
        /**
         * MessageTextFilter didn't want me to extend it much, so I have to define mine.
        */
        
        let ExpressionFilter = {
          name: "expression",
          domId: "expression-search-textbox",

          appendTerms: function(aTermCreator, aTerms, aFilterValue) {
            if (aFilterValue.text) {
              try {
                if ( aFilterValue.text.toLowerCase().indexOf('g:') == 0 ) { // may get called when init with saved values in searchInput.
                  return;
                }
                // first remove trailing specifications if it's empty
                // then remove trailing ' and' but no remove of "f: and"
                var aSearchString = aFilterValue.text.replace(/(?:^|\s+)(?:from|f|to|t|subject|s|all|body|b|attachment|a|tag|label|l):(?:\(|)\s*$/i,'');
                if ( aSearchString.search(/\b(?:from|f|to|t|subject|s|all|body|b|attachment|a|tag|label|l):\s+and\s*$/i) == -1 ) {
                  aSearchString = aSearchString.replace(/\s+\and\s*$/i,'');
                }
                aSearchString.replace(/\s+$/,'');
                if ( aSearchString == '' ) {
                  return;
                }
                var e = compute_expression(aSearchString);
                if ( ExpressionSearchChrome.latchQSFolderReq ) {
                  let terms = aTerms.slice();
                  ExpressionSearchChrome.createSearchTermsFromExpression(e,aTermCreator,terms);
                  ExpressionSearchChrome.createQuickFolder(terms);
                  ExpressionSearchChrome.latchQSFolderReq = 0;
                } else {
                  ExpressionSearchChrome.createSearchTermsFromExpression(e,aTermCreator,aTerms);
                }
                return;
              } catch (err) {
                ExpressionSearchLog.logException(err);
              }
            }
          },

          domBindExtra: function(aDocument, aMuxer, aNode) {
            /*
            if ( 'undefined' == typeof(ExpressionSearchChrome) ) {
              // If this filter was NOT removed from the quickFilterManager and closed Mail window and re-open Mail window
              return; 
            }*/
            // -- platform-dependent emptytext setup
            let filterNode = aDocument.getElementById('qfb-qs-textbox');
            let quickKey = '';
            if ( filterNode && typeof(Application)!='undefined' ) {
              quickKey = filterNode.getAttribute(Application.platformIsMac ? "keyLabelMac" : "keyLabelNonMac");
              // now Ctrl+F will focus to our input, so remove the message in this one
              filterNode.setAttribute( "emptytext", filterNode.getAttribute("emptytextbase").replace("#1", '') );
              // force to update the message
              filterNode.value = '';
              ExpressionSearchChrome.refreshFilterBar();
            }
            aNode.setAttribute( "emptytext", aNode.getAttribute("emptytextbase").replace("#1", quickKey) );
            // force an update of the emptytext now that we've updated it.
            aNode.value = "";
            if ( aNode && aNode._fireCommand ) {
              aNode.addEventListener("keypress", ExpressionSearchChrome.onSearchKeyPress, true); // false will be after onComand, too later, 
            }
          },

          getDefaults: function() { // this function get called pretty early
            return {
              text: null,
            };
          },

          propagateState: function(aOld, aSticky) {
            return {
              // must clear state when create quick search folder, or recursive call happenes when aSticky.
              text: ( aSticky && !ExpressionSearchChrome.latchQSFolderReq )? aOld.text : null,
              //states: {},
            };
          },

          onCommand: function(aState, aNode, aEvent, aDocument) { // may get skipped when init, but appendTerms get called
            let text = aNode.value.length ? aNode.value : null;
            aState = aState || {}; // or will be no search.
            let needSearch = false;
            if ( ExpressionSearchChrome.isEnter ) {
              // press Enter to select searchInput
              aNode.select();
              // if text not null and create qs folder return true
              if ( text && ExpressionSearchChrome.latchQSFolderReq ) {
                needSearch = true;
              }
            }
            if ( text != aState.text ) {
              aState.text = text;
              needSearch = true;
            }
            return [aState, needSearch];
          },

          // change DOM status, eg disabled, checked, etc.
          reflectInDOM: function(aNode, aFilterValue,
                                aDocument, aMuxer,
                                aFromPFP) { //PFP: PostFilterProcess, the second value PFP returns
            // Update the text if it has changed (linux does weird things with empty
            //  text if we're transitioning emptytext to emptytext)
            let desiredValue = "";
            if ( aFilterValue && aFilterValue.text ) {
              desiredValue = aFilterValue.text;
            }
            if (aNode.value != desiredValue) {
              if ( aFromPFP ) {
              } else {
                aNode.value = desiredValue;
              }
            }
            
            // now search is done, expand first container if closed
            if ( typeof(gFolderDisplay)!='undefined' && gFolderDisplay.tree && gFolderDisplay.tree.treeBoxObject && gFolderDisplay.tree.treeBoxObject.view ) {
              var treeView = gFolderDisplay.tree.treeBoxObject.view;
              if ( aNode.value != '' && treeView.rowCount > 0 && treeView.isContainer(0) && !treeView.isContainerOpen(0)) {
                treeView.toggleOpenState(0);
              }
            }
          },

          postFilterProcess: function(aState,
                                      aViewWrapper,
                                      aFiltering) {
            return [aState, true, false]; // true for call reflectInDOM
          },
        };

        QuickFilterManager.defineFilter(ExpressionFilter);
        QuickFilterManager.textBoxDomId = ExpressionFilter.domId;
      },
      
      // not works well for complex searchTerms. But it's for all folders.
      createQuickFolder: function(searchTerms) {
        const nsMsgFolderFlags = this.Ci.nsMsgFolderFlags;
        var currFolder = gFolderDisplay.displayedFolder;
        var currURI = currFolder.URI;
        var rootFolder = currFolder.rootFolder;
        var QSFolderName = "ExpressionSearch";
        var uriSearchString = "";
        if (!rootFolder) {
          alert('Expression Search: Cannot determine root folder of search');
          return;
        }
        var QSFolderURI = rootFolder.URI + "/" + QSFolderName;
        
        if ( !rootFolder.containsChildNamed(QSFolderName) || ! this.reuse_existing_folder ) {
          var allFolders = Components.classes["@mozilla.org/supports-array;1"].createInstance(Components.interfaces.nsISupportsArray);
          rootFolder.ListDescendents(allFolders);
          var numFolders = allFolders.Count();
          for (var folderIndex = 0; folderIndex < numFolders; folderIndex++) {
            var folder = allFolders.GetElementAt(folderIndex).QueryInterface(Components.interfaces.nsIMsgFolder);
            var uri = folder.URI;
            // only add non-virtual non-new folders
            if ( !folder.isSpecialFolder(nsMsgFolderFlags.Newsgroup,false) && !folder.isSpecialFolder(nsMsgFolderFlags.Virtual,false) ) {
              if (uriSearchString != "") {
                uriSearchString += "|";
              }
              uriSearchString += uri;
            }
          }
        }

        //Check if folder exists already
        if (rootFolder.containsChildNamed(QSFolderName)) {
          // modify existing folder
          var msgFolder = GetMsgFolderFromUri(QSFolderURI);
          if (!msgFolder.isSpecialFolder(nsMsgFolderFlags.Virtual,false)) {
            alert('Expression Search: Non search folder '+QSFolderName+' is in the way');
            return;
          }
          // save the settings
          let virtualFolderWrapper = VirtualFolderHelper.wrapVirtualFolder(msgFolder);
          virtualFolderWrapper.searchTerms = searchTerms;
          if ( ! this.reuse_existing_folder ) {
            virtualFolderWrapper.searchFolders = uriSearchString;
          }
          virtualFolderWrapper.onlineSearch = false;
          virtualFolderWrapper.cleanUpMessageDatabase();
          var accountManager = Components.classes["@mozilla.org/messenger/account-manager;1"].getService(Components.interfaces.nsIMsgAccountManager);
          accountManager.saveVirtualFolders();
        } else {
          VirtualFolderHelper.createNewVirtualFolder(QSFolderName, rootFolder, uriSearchString, searchTerms, false);
        }

        if (currURI == QSFolderURI) {
          // select another folder to force reload of our virtual folder
          SelectFolder(rootFolder.getFolderWithFlags(nsMsgFolderFlags.Inbox).URI);
        }
        SelectFolder(QSFolderURI);
      },
      
      addSearchTerm: function(aTermCreator, searchTerms, str, attr, op, is_or, grouping) {
        var term,value;
        term = aTermCreator.createTerm();
        term.attrib = attr;
        value = term.value;
        // This is tricky - value.attrib must be set before actual values, from searchTestUtils.js 
        value.attrib = attr;

        if (attr == nsMsgSearchAttrib.JunkPercent)
          value.junkPercent = str;
        else if (attr == nsMsgSearchAttrib.Priority)
          value.priority = str;
        else if (attr == nsMsgSearchAttrib.Date)
          value.date = str;
        else if (attr == nsMsgSearchAttrib.MsgStatus || attr == nsMsgSearchAttrib.FolderFlag || attr == nsMsgSearchAttrib.Uint32HdrProperty)
          value.status = str;
        else if (attr == nsMsgSearchAttrib.MessageKey)
          value.msgKey = str;
        else if (attr == nsMsgSearchAttrib.Size)
          value.size = str;
        else if (attr == nsMsgSearchAttrib.AgeInDays)
          value.age = str;
        else if (attr == nsMsgSearchAttrib.Size)
          value.size = str;
        else if (attr == nsMsgSearchAttrib.Label)
          value.label = str;
        else if (attr == nsMsgSearchAttrib.JunkStatus)
          value.junkStatus = str;
        else if (attr == nsMsgSearchAttrib.HasAttachmentStatus)
          value.status = nsMsgMessageFlags.Attachment;
        else
          value.str = str;

        term.value = value;
        term.op = op;
        term.booleanAnd = !is_or;
        
        if (attr == nsMsgSearchAttrib.Custom)
          term.customId = aCustomId;
        else if (attr == nsMsgSearchAttrib.OtherHeader)
          term.arbitraryHeader = aArbitraryHeader;
        else if (attr == nsMsgSearchAttrib.HdrProperty || attr == nsMsgSearchAttrib.Uint32HdrProperty)
          term.hdrProperty = aHdrProperty;

        //ExpressionSearchLog.log("Expression Search: "+term.termAsString);
        searchTerms.push(term);
      },

      get_key_from_tag: function(myTag) {
        var tagService = Components.classes["@mozilla.org/messenger/tagservice;1"].getService(Components.interfaces.nsIMsgTagService); 
        var tagArray = tagService.getAllTags({});
        var unique = undefined;
        // consider two tags, one is "ABC", the other is "ABCD", when searching for "AB", perfect is return both.
        // however, that need change the token tree.
        // so here I just return the best fit "ABC".
        var myTagLen = myTag.length;
        var lenDiff = 10000000; // big enough?
        for (var i = 0; i < tagArray.length; ++i) {
            var tag = tagArray[i].tag;
            var key = tagArray[i].key;
            tag = tag.toLowerCase();
            if (tag.indexOf(myTag) >= 0 && ( tag.length-myTagLen < lenDiff ) ) {
              unique = key;
              lenDiff = tag.length-myTagLen;
              if ( lenDiff == 0 ) {
                break;
              }
            }
        }
        if (unique != undefined) 
            return unique;
        else
            return "..unknown..";
      },

      convertExpression: function(e,aTermCreator,searchTerms,was_or) {
        var is_not = false;
        if (e.kind == 'op' && e.tok == '-') {
          if (e.left.kind != 'spec') {
            ExpressionSearchLog.log('Exression Search: unexpected expression tree');
            return;
          }
          e = e.left;
          is_not = true;
        }
        if (e.kind == 'spec') {
          var attr;
          if (e.tok == 'from') attr = nsMsgSearchAttrib.Sender;
          else if (e.tok == 'to') attr = nsMsgSearchAttrib.ToOrCC;
          else if (e.tok == 'subject') attr = nsMsgSearchAttrib.Subject;
          else if (e.tok == 'body') attr = nsMsgSearchAttrib.Body;
          else if (e.tok == 'attachment') attr = nsMsgSearchAttrib.HasAttachmentStatus;
          else if (e.tok == 'status') attr = nsMsgSearchAttrib.MsgStatus;
          else if (e.tok == 'before' || e.tok == 'after') attr = nsMsgSearchAttrib.Date;
          else if (e.tok == 'tag') {
            e.left.tok = this.get_key_from_tag(e.left.tok);
            attr = nsMsgSearchAttrib.Keywords;
          } else if (e.tok == 'calc' ) {
            return;
          } else {ExpressionSearchLog.log('Exression Search: unexpected specifier'); return; }
          var op = is_not ? nsMsgSearchOp.DoesntContain:nsMsgSearchOp.Contains;
          if (e.left.kind != 'str') {
            ExpressionSearchLog.log('Exression Search: unexpected expression tree');
            return;
          }
          if (e.tok == 'attachment') {
            if (!/^[Yy1]/.test(e.left.tok)) {
              // looking for no attachment; reverse is_noto.
              is_not = !is_not;
            }
          }
          if ( attr == nsMsgSearchAttrib.Date) {
            // is before: before => false, true: true
            // is after: after   => false, false: false
            // isnot before: after => true, ture: false
            // isnot after: before => true, false: true
            op = (is_not^(e.tok=='before')) ? nsMsgSearchOp.IsBefore : nsMsgSearchOp.IsAfter;
            var date;
            try {
              var inValue = e.left.tok;
              date = new Date(inValue);
              e.left.tok = date.getTime()*1000; // why need *1000, I don't know ;-)
              if ( isNaN(e.left.tok) ) {
                ExpressionSearchLog.log('Expression Search: date '+ inValue + " is not valid");
                return;
              }
            } catch (err) {
              ExpressionSearchLog.logException(err);
              return;
            }
          }
          if (e.tok == 'status') {
            if (/^Rep/i.test(e.left.tok))
              e.left.tok = nsMsgMessageFlags.Replied;
            else if (/^Rea/i.test(e.left.tok))
              e.left.tok = nsMsgMessageFlags.Read;
            else if (/^M/i.test(e.left.tok))
              e.left.tok = nsMsgMessageFlags.Marked;
            else if (/^F/i.test(e.left.tok))
              e.left.tok = nsMsgMessageFlags.Forwarded;
            else if (/^A/i.test(e.left.tok))
              e.left.tok = nsMsgMessageFlags.Attachment;
            else if (/^UnR/i.test(e.left.tok)) {
              e.left.tok = nsMsgMessageFlags.Read;
              is_not = !is_not;
            } else {
              ExpressionSearchLog.log('Exression Search: unknown status '+e.left.tok);
              return;
            }
          }
          if (e.tok == 'attachment' || e.tok == 'status') {
            op = is_not ? nsMsgSearchOp.Isnt : nsMsgSearchOp.Is;
          }
          
          this.addSearchTerm(aTermCreator, searchTerms, e.left.tok, attr, op, was_or);
          return;
        }
        if (e.left != undefined)
          this.convertExpression(e.left, aTermCreator, searchTerms, was_or);
        if (e.right != undefined)
          this.convertExpression(e.right, aTermCreator, searchTerms, e.kind == 'op' && e.tok == 'or');
      },

      createSearchTermsFromExpression: function(e,aTermCreator,searchTerms) {
        // start converting the search expression.  Every search term
        // has an and or or field in it.  My current understanding is
        // that it's what this term should be preceded by.  Of course it
        // doesn't apply to the first term, but it appears the search
        // dialog uses it to set the radio button.  The dialog cannot
        // possibly deal with anything but expressions that are all one
        // or the other logical operator, but at least if the user gives
        // us an expression that is only or's, let's use the or value
        // for the type of the first term (second param to
        // convertExpression).  You can prove that the top expression
        // node will only be an 'or' if all operators are ors.
        this.convertExpression(e,aTermCreator,searchTerms, e.kind=='op' && e.tok=='or');

        // Add grouping attributes.  Look for the beginning and end of
        // each disjunct and mark it with grouping
        var firstDJTerm = -1;
        var priorTerm = null;

        for (var i = 0; i < searchTerms.length; i++) {
          if (!searchTerms[i].booleanAnd) {
            if (priorTerm != null) {
              firstDJTerm = i - 1;
              priorTerm.beginsGrouping = true;
            }
          } else {
            if (firstDJTerm != -1) {
              priorTerm.endsGrouping = true;
              firstDJTerm = -1;
            }
          }
          priorTerm = searchTerms[i];
        }
        if (firstDJTerm != -1) {
          priorTerm.endsGrouping = true;
          firstDJTerm = -1;
        }
        return null;
      },

      calculateResult: function(e) {
        if (e.kind == 'op') {
          if (e.tok == '+' || (e.right != undefined && e.tok == '-') || e.tok == '*' || e.tok == '/') {
            var r1 = this.calculateResult(e.left);
            var r2 = this.calculateResult(e.right);
            if (r1.kind == 'error')
              return r1;
            else if (r2.kind == 'error')
              return r2;
            else {
              if (e.tok == '+')
                return { kind: 'num', tok: r1.tok+r2.tok };
              else if (e.tok == '-')
                return { kind: 'num', tok: r1.tok-r2.tok };
              else if (e.tok == '*')
                return { kind: 'num', tok: r1.tok*r2.tok };
              else if (e.tok == '/') {
                // divide by zero is okay, it just results in infinity
                return { kind: 'num', tok: r1.tok/r2.tok };
              }
            }
          } else if (e.tok == '-') {
            var r1 = calculateResult(e.left);
            if (r1.kind == 'error')
              return r1;
            else
              return { kind: 'num', tok: -r1.tok };
          }
        } else if (e.kind == 'num') {
          return e;
        } else {
          ExpressionSearchLog.log('Expression Search: unexpected expression tree when calculating result');
          return { kind: 'error', tok: 'internal' };
        }
      },

      showCalculationResult: function(e) {
        e = e.left; // skip the calc: specifier
        // compute the result of this calculation
        var r = this.calculateResult(e);
        // print the expression,
        var lhs = expr_tostring_infix(e);
        var rhs = '' + ((r.kind == 'num') ? r.tok : "<<ERROR: "+r.tok+">>");
        var x = document.getElementById('expression-search-textbox');
        x.value = lhs + " = " + rhs;
        x.setSelectionRange(lhs.length, lhs.length + rhs.length + 3);
      },

    };
    
    // this is much complex than 'ExpressionSearchChrome.init();' and both works ;-)
    (function() { this.init(); }).apply(ExpressionSearchChrome);
    //onload is too late for me to register
    //window.addEventListener("load", function() { ExpressionSearchChrome.init(); }, false);
    window.addEventListener("unload", ExpressionSearchChrome.unregister, false);
};

// TODO:
// use https://developer.mozilla.org/en/STEEL ? maybe not