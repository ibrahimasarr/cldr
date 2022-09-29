/**
 * cldrVote: encapsulate Survey Tool voting interface
 */
import * as cldrAjax from "./cldrAjax.js";
import * as cldrDom from "./cldrDom.js";
import * as cldrEvent from "./cldrEvent.js";
import * as cldrInfo from "./cldrInfo.js";
import * as cldrLoad from "./cldrLoad.js";
import * as cldrRetry from "./cldrRetry.js";
import * as cldrStatus from "./cldrStatus.js";
import * as cldrSurvey from "./cldrSurvey.js";
import * as cldrTable from "./cldrTable.js";
import * as cldrText from "./cldrText.js";

const CLDR_VOTE_DEBUG = false;

/**
 * The special "vote level" selected by the user, or zero for default.
 * For example, admin has vote level 100 by default, and can instead choose vote level 4.
 * When admin chooses 4 from the menu, voteLevelChanged gets 4.
 * When admin chooses 100 (default) from the menu, voteLevelChanged gets 0 (not 100).
 */
let voteLevelChanged = 0;

/**
 * Wire up the button to perform a submit
 *
 * @param button
 * @param tr
 * @param theRow
 * @param vHash
 */
function wireUpButton(button, tr, theRow, vHash) {
  if (vHash == null) {
    // this is an "Abstain" ("no") button
    button.id = "NO_" + tr.rowHash;
    vHash = "";
  } else {
    // this is a vote button for a candidate item
    button.id = "v" + vHash + "_" + tr.rowHash;
  }
  cldrDom.listenFor(button, "change", function (e) {
    if (button.checked) {
      handleWiredClick(tr, theRow, vHash, undefined, button);
    }
    cldrEvent.stopPropagation(e);
    return false;
  });

  // proposal issues
  if (tr.myProposal) {
    if (button == tr.myProposal.button) {
      button.className = "ichoice-x";
      button.checked = true;
      tr.lastOn = button;
    } else {
      button.className = "ichoice-o";
      button.checked = false;
    }
  } else if (theRow.voteVhash == vHash) {
    button.className = "ichoice-x";
    button.checked = true;
    tr.lastOn = button;
  } else {
    button.className = "ichoice-o";
    button.checked = false;
  }
}

/**
 * Handle a voting event
 *
 * @param {Element} tr the table row
 * @param {Object} theRow object describing the table row
 * @param {String} vHash hash of the value of the candidate item (cf. DataPage.getValueHash on back end),
 *                       or empty string for newly submitted value
 * @param {Object} newValue the newly submitted value, or undefined if it's a vote for an already existing value (button.value)
 * @param {Element} button the GUI button
 *
 * TODO: shorten this function, using (non-nested) subroutines
 *
 * Called from cldrTable.addValueVote (for new value submission)
 * as well as locally in cldrVote (vote for existing value or abstain)
 */
function handleWiredClick(tr, theRow, vHash, newValue, button) {
  if (!tr || !theRow || tr.wait) {
    return;
  }
  var value = "";
  var valToShow;
  if (newValue) {
    valToShow = newValue;
    value = newValue;
    if (value.length == 0) {
      return; // nothing entered.
    }
  } else {
    valToShow = button.value;
  }
  button.className = "ichoice-x-ok"; // TODO: ichoice-inprogress? spinner?
  cldrSurvey.showLoader(cldrText.get("voting"));

  // select
  cldrLoad.updateCurrentId(theRow.xpstrid);

  // and scroll
  cldrLoad.showCurrentId();

  if (tr.myProposal) {
    const otherCell = tr.querySelector(".othercell");
    if (otherCell) {
      otherCell.removeChild(tr.myProposal);
    }
    tr.myProposal = null; // mark any pending proposal as invalid.
  }

  var myUnDefer = function () {
    tr.wait = false;
  };
  tr.wait = true;
  cldrInfo.reset();
  theRow.proposedResults = null;

  if (CLDR_VOTE_DEBUG) {
    console.log(
      "Vote for " + tr.rowHash + " v='" + vHash + "', value='" + value + "'"
    );
  }
  var ourContent = {
    what: "submit" /* cf. WHAT_SUBMIT in SurveyAjax.java */,
    xpath: tr.xpathId,
    _: cldrStatus.getCurrentLocale(),
    fhash: tr.rowHash,
    vhash: vHash,
    s: tr.theTable.session,
  };

  let ourUrl = cldrStatus.getContextPath() + "/SurveyAjax";

  if (voteLevelChanged) {
    ourContent.voteLevelChanged = voteLevelChanged;
  }

  var originalTrClassName = tr.className;
  tr.className = "tr_checking1";

  var loadHandler = function (json) {
    /*
     * Restore tr.className, so it stops being 'tr_checking1' immediately on receiving
     * any response. It may change again below, such as to 'tr_err' or 'tr_checking2'.
     */
    tr.className = originalTrClassName;
    oneLessPendingVote();
    try {
      if (json.err && json.err.length > 0) {
        tr.className = "tr_err";
        cldrRetry.handleDisconnect("Error submitting a vote", json);
        tr.innerHTML =
          "<td colspan='4'>" +
          cldrStatus.stopIcon() +
          " Could not check value. Try reloading the page.<br>" +
          json.err +
          "</td>";
        myUnDefer();
        cldrRetry.handleDisconnect("Error submitting a vote", json);
      } else {
        if (json.submitResultRaw) {
          // if submitted..
          tr.className = "tr_checking2";
          cldrTable.refreshSingleRow(
            tr,
            theRow,
            function (theRow) {
              // submit went through. Now show the pop.
              button.className = "ichoice-o";
              button.checked = false;
              cldrSurvey.hideLoader();
              if (json.testResults && (json.testWarnings || json.testErrors)) {
                // tried to submit, have errs or warnings.
                showProposedItem(
                  tr.inputTd,
                  tr,
                  theRow,
                  valToShow,
                  json.testResults
                );
              }
              myUnDefer();
            },
            function (err) {
              myUnDefer();
              cldrRetry.handleDisconnect(err, json);
            }
          ); // end refresh-loaded-fcn
          // end: async
        } else {
          // Did not submit. Show errors, etc
          if (
            (json.statusAction && json.statusAction != "ALLOW") ||
            (json.testResults && (json.testWarnings || json.testErrors))
          ) {
            showProposedItem(
              tr.inputTd,
              tr,
              theRow,
              valToShow,
              json.testResults,
              json
            );
          } // else no errors, not submitted.  Nothing to do.
          button.className = "ichoice-o";
          button.checked = false;
          cldrSurvey.hideLoader();
          myUnDefer();
        }
      }
    } catch (e) {
      tr.className = "tr_err";
      tr.innerHTML =
        cldrStatus.stopIcon() +
        " Could not check value. Try reloading the page.<br>" +
        e.message;
      console.log("Error in ajax post [handleWiredClick] ", e.message);
      myUnDefer();
      cldrRetry.handleDisconnect("handleWiredClick:" + e.message, json);
    }
  };
  var errorHandler = function (err) {
    /*
     * Restore tr.className, so it stops being 'tr_checking1' immediately on receiving
     * any response. It may change again below, such as to 'tr_err'.
     */
    tr.className = originalTrClassName;
    oneLessPendingVote();
    console.log("Error: " + err);
    cldrRetry.handleDisconnect("Error: " + err, null);
    theRow.className = "ferrbox";
    theRow.innerHTML =
      "Error while  loading: <div style='border: 1px solid red;'>" +
      err +
      "</div>";
    myUnDefer();
  };
  if (newValue) {
    ourContent.value = value;
  }
  const xhrArgs = {
    url: ourUrl,
    handleAs: "json",
    content: ourContent,
    load: loadHandler,
    error: errorHandler,
    timeout: cldrAjax.mediumTimeout(),
  };
  oneMorePendingVote();
  cldrAjax.sendXhr(xhrArgs);
}

/**
 * Show an item that's not in the saved data, but has been proposed newly by the user.
 * Called only by loadHandler in handleWiredClick.
 * Used for "+" button in table.
 */
function showProposedItem(inTd, tr, theRow, value, tests, json) {
  // Find where our value went.
  var ourItem = cldrSurvey.findItemByValue(theRow.items, value);
  var testKind = getTestKind(tests);
  var ourDiv = null;
  var wrap;
  if (!ourItem) {
    /*
     * This may happen if, for example, the user types a space (" ") in
     * the input pop-up window and presses Enter. The value has been rejected
     * by the server. Then we show an additional pop-up window with the error message
     * from the server like "Input Processor Error: DAIP returned a 0 length string"
     */
    ourDiv = document.createElement("div");
    var newButton = cldrSurvey.cloneAnon(
      document.getElementById("proto-button")
    );
    const otherCell = tr.querySelector(".othercell");
    if (otherCell && tr.myProposal) {
      otherCell.removeChild(tr.myProposal);
    }
    tr.myProposal = ourDiv;
    tr.myProposal.value = value;
    tr.myProposal.button = newButton;
    if (newButton) {
      newButton.value = value;
      if (tr.lastOn) {
        tr.lastOn.checked = false;
        tr.lastOn.className = "ichoice-o";
      }
      wireUpButton(newButton, tr, theRow, "[retry]", {
        value: value,
      });
      wrap = wrapRadio(newButton);
      ourDiv.appendChild(wrap);
    }
    var h3 = document.createElement("span");
    var span = appendItem(h3, value, "value");
    ourDiv.appendChild(h3);
    if (otherCell) {
      otherCell.appendChild(tr.myProposal);
    }
  } else {
    ourDiv = ourItem.div;
  }
  if (json && !cldrSurvey.parseStatusAction(json.statusAction).vote) {
    ourDiv.className = "d-item-err";

    const replaceErrors =
      json.statusAction === "FORBID_PERMANENT_WITHOUT_FORUM";
    if (replaceErrors) {
      /*
       * Special case: for clarity, replace any warnings/errors that may be
       * in tests[] with a single error message for this situation.
       */
      tests = [
        {
          type: "Error",
          message: cldrText.get("StatusAction_" + json.statusAction),
        },
      ];
    }

    var input = $(inTd).closest("tr").find(".input-add");
    if (input) {
      input.closest(".form-group").addClass("has-error");
      input
        .popover("destroy")
        .popover({
          placement: "bottom",
          html: true,
          content: cldrSurvey.testsToHtml(tests),
          trigger: "hover",
        })
        .popover("show");
      if (tr.myProposal) tr.myProposal.style.display = "none";
    }
    if (ourItem || (replaceErrors && value === "") /* Abstain */) {
      let str = cldrText.sub(
        "StatusAction_msg",
        [cldrText.get("StatusAction_" + json.statusAction)],
        "p",
        ""
      );
      var str2 = cldrText.sub(
        "StatusAction_popupmsg",
        [cldrText.get("StatusAction_" + json.statusAction), theRow.code],
        "p",
        ""
      );
      // show in modal popup (ouch!)
      alert(str2);

      // show this message in a sidebar also
      const message = cldrStatus.stopIcon() + str;
      cldrInfo.showWithRow(message, tr);
    }
    return;
  } else if (json && json.didNotSubmit) {
    ourDiv.className = "d-item-err";
    const message = "(ERROR: Unknown error - did not submit this value.)";
    cldrInfo.showWithRow(message, tr);
    return;
  } else {
    setDivClass(ourDiv, testKind);
  }

  if (testKind || !ourItem) {
    var div3 = document.createElement("div");
    var newHtml = "";
    newHtml += cldrSurvey.testsToHtml(tests);

    if (!ourItem) {
      var h3 = document.createElement("h3");
      var span = appendItem(h3, value, "value");
      h3.className = "span";
      div3.appendChild(h3);
    }
    var newDiv = document.createElement("div");
    div3.appendChild(newDiv);
    newDiv.innerHTML = newHtml;
    if (json && !parseStatusAction(json.statusAction).vote) {
      div3.appendChild(
        cldrDom.createChunk(
          cldrText.sub(
            "StatusAction_msg",
            [cldrText.get("StatusAction_" + json.statusAction)],
            "p",
            ""
          )
        )
      );
    }

    div3.popParent = tr;

    // will replace any existing function
    var ourShowFn = function (showDiv) {
      var retFn;
      if (ourItem && ourItem.showFn) {
        retFn = ourItem.showFn(showDiv);
      } else {
        retFn = null;
      }
      if (tr.myProposal && value == tr.myProposal.value) {
        // make sure it wasn't submitted twice
        showDiv.appendChild(div3);
      }
      return retFn;
    };
    cldrInfo.listen(null, tr, ourDiv, ourShowFn);
    cldrInfo.showRowObjFunc(tr, ourDiv, ourShowFn);
  }
  return false;
}

function setDivClass(div, testKind) {
  if (!testKind) {
    div.className = "d-item";
  } else if (testKind == "Warning") {
    div.className = "d-item-warn";
  } else if (testKind == "Error") {
    div.className = "d-item-err";
  } else {
    div.className = "d-item";
  }
}

/**
 * Determine whether a JSONified array of CheckCLDR.CheckStatus is overall a warning or an error.
 *
 * @param {Object} testResults - array of CheckCLDR.CheckStatus
 * @returns {String} 'Warning' or 'Error' or null
 *
 * Note: when a user votes, the response to the POST request includes json.testResults,
 * which often (always?) includes a warning "Needed to meet ... coverage level", possibly
 * in addition to other warnings or errors. We then return Warning, resulting in
 * div.className = "d-item-warn" and a temporary yellow background for the cell, which, however,
 * goes back to normal color (with "d-item") after a multiple-row response is received.
 * The message "Needed to meet ..." may not actually be displayed, in which case the yellow
 * background is distracting; its purpose should be clarified.
 */
function getTestKind(testResults) {
  if (!testResults) {
    return null;
  }
  var theKind = null;
  for (var i = 0; i < testResults.length; i++) {
    var tr = testResults[i];
    if (tr.type == "Warning") {
      theKind = tr.type;
    } else if (tr.type == "Error") {
      return tr.type;
    }
  }
  return theKind;
}

/**
 * Add to the radio button, a more button style
 *
 * @param button
 * @returns a newly created label element
 */
function wrapRadio(button) {
  var label = document.createElement("label");
  label.title = "Vote";
  label.className = "btn btn-default";
  label.appendChild(button);
  $(label).tooltip();
  return label;
}

/**
 * Append just an editable span representing a candidate voting item
 * Calls setLang() automatically
 *
 * @param div {DOM} div to append to
 * @param value {String} string value
 * @param pClass {String} html class for the voting item
 * @return {DOM} the new span
 */
function appendItem(div, value, pClass) {
  if (!value) {
    return;
  }
  var text = document.createTextNode(value);
  var span = document.createElement("span");
  span.appendChild(text);
  if (!value) {
    span.className = "selected";
  } else if (pClass) {
    span.className = pClass;
  } else {
    span.className = "value";
  }
  cldrSurvey.setLang(span);
  div.appendChild(span);
  return span;
}

function setVoteLevelChanged(n) {
  const num = Number(n);
  if (num !== voteLevelChanged) {
    if (num === Number(cldrStatus.getSurveyUser().votecount)) {
      voteLevelChanged = 0;
    } else {
      voteLevelChanged = num;
    }
  }
}

let pendingVoteCount = 0;
let lastTimeChanged = 0;

function oneMorePendingVote() {
  ++pendingVoteCount;
  lastTimeChanged = Date.now();
  if (CLDR_VOTE_DEBUG) {
    console.log("oneMorePendingVote: ++pendingVoteCount = " + pendingVoteCount);
  }
}

function oneLessPendingVote() {
  --pendingVoteCount;
  if (pendingVoteCount < 0) {
    console.log(
      "Error in oneLessPendingVote: changing to zero from negative " +
        pendingVoteCount
    );
    pendingVoteCount = 0;
  }
  lastTimeChanged = Date.now();
  if (CLDR_VOTE_DEBUG) {
    console.log("oneLessPendingVote: --pendingVoteCount = " + pendingVoteCount);
  }
  if (pendingVoteCount == 0) {
    cldrSurvey.expediteStatusUpdate();
  }
}

/**
 * Are we busy waiting for completion of voting activity?
 *
 * @return true if this module is busy enough to justify postponing
 *         some other actions/requests; else false
 *
 * For example, if we're busy waiting for a server response about voting
 * results, or the browser hasn't had time to update the display, the caller
 * should postpone making a request to update the entire data section.
 */
function isBusy() {
  if (pendingVoteCount > 0) {
    if (CLDR_VOTE_DEBUG) {
      console.log("cldrVote busy: pendingVoteCount = " + pendingVoteCount);
    }
    return true;
  }
  if (Date.now() - lastTimeChanged < 3000) {
    if (CLDR_VOTE_DEBUG) {
      console.log("cldrVote busy: less than 3 seconds elapsed");
    }
    return true;
  }
  if (CLDR_VOTE_DEBUG) {
    console.log("cldrVote not busy");
  }
  return false;
}

export {
  appendItem,
  getTestKind,
  handleWiredClick,
  isBusy,
  setDivClass,
  setVoteLevelChanged,
  wireUpButton,
  wrapRadio,
};
