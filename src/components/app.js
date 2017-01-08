import React from "react";
// import { connect } from "react-redux";
import probabilities from "../sampleData/probabilities";
import covariance from "../sampleData/covariance";
import correlation from "../sampleData/correlation";
import correlationHClust from "../sampleData/correlationHClust"

import Radium from "radium";
import _ from "lodash";

import Matrix from "./Matrix";
import Heading from "./Heading";
import Overview from "./Overview";
import Consensus from "./Consensus";
import Contested from "./Contested";
import AllComments from "./AllComments";
import ParticipantGroups from "./ParticipantGroups";
import Graph from "./Graph";

import net from "../util/net"

import $ from 'jquery';

var conversation_id = "2ez5beswtc";

class App extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      consensus: null,
      comments: null,
      participants: null,
      probabilitiesAgree: null,
      probabilitiesAgreeTids: null,
      conversation: null,
      groupDemographics: null,
      dimensions: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
  }

  getMath() {
    return net.polisGet("/api/v3/math/pca2", {
      lastVoteTimestamp: 0,
      conversation_id: conversation_id,
    });
  }

  getAgreeMatrix() {
    return net.polisGet("/api/v3/voteProbabilityMatrixAgree", {
      conversation_id: conversation_id,
    });
  }
  getComments() {
    return net.polisGet("/api/v3/comments", {
      conversation_id: conversation_id,
      moderation: true,
      mod_gt: -1,
      include_social: true,
      include_demographics: true
    });
  }

  getParticipantsOfInterest() {
    return net.polisGet("/api/v3/ptptois", {
      conversation_id: conversation_id,
    });
  }
  getConversation() {
    return net.polisGet("/api/v3/conversations", {
      conversation_id: conversation_id,
    });
  }
  getGroupDemographics() {
    return net.polisGet("/api/v3/group_demographics", {
      conversation_id: conversation_id,
    });

  }
  getData() {
    Promise.all([
      this.getMath(),
      this.getAgreeMatrix(),
      this.getComments(),
      this.getParticipantsOfInterest(),
      this.getConversation(),
      this.getGroupDemographics()
    ]).then((a) => {
      const mathResult = a[0];
      const coOccurrenceAgreeResult = a[1];
      const comments = a[2];
      const participants = a[3];
      const conversation = a[4];
      const groupDemographics = a[5];

      var ptptCount = 0;
      _.each(mathResult["group-votes"], (val, key) => {
        ptptCount += val["n-members"];
      });

      // prep Correlation matrix.
      var probabilities = correlationHClust.matrix;
      var tids =  correlationHClust.comments;
      var badTids = {};
      for (let row = 0; row < probabilities.length; row++) {
        if (probabilities[row][0] === "NaN") {
          badTids[row] = true;
        }
      }
      var filteredProbabilities = probabilities.map((row) => {
        return row.filter((cell, colTid) => {
          return badTids[colTid] !== true;
        });
      }).filter((row, rowTid) => {
          return badTids[rowTid] !== true;
      });
      var filteredTids =tids.filter((tid, index) => {
        return badTids[tid] !== true;
      });


      this.setState({
        math: mathResult,
        consensus: mathResult.consensus,
        comments: comments,
        demographics: groupDemographics,
        participants: participants,
        probabilitiesAgree: coOccurrenceAgreeResult.matrix,
        probabilitiesAgreeTids: coOccurrenceAgreeResult.rowToTid,
        conversation: conversation,
        ptptCount: ptptCount,
        filteredCorrelationMatrix: filteredProbabilities,
        filterecCorrelationTids: filteredTids,
      });
    }, (err) => {
      this.setState({
        probabilitiesAgreeError: (err || true),
      });
    });
  }

  componentWillMount() {
    this.getData();
    window.addEventListener("resize", _.throttle(() => {
      this.setState({
        dimensions: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      })
    }, 500));
  }

  render() {
    return (
      <div style={{margin: 20}}>
        <Heading conversation={this.state.conversation}/>
        <Overview
          ptptCount={this.state.ptptCount}
          demographics={this.state.demographics}
          conversation={this.state.conversation}/>
        <Consensus
          conversation={this.state.conversation}
          ptptCount={this.state.ptptCount}
          comments={this.state.comments}
          consensus={this.state.consensus}/>
        {/*<Matrix
          title={"Co occurance matrix"}
          probabilities={this.state.probabilitiesAgree}
          tids={this.state.probabilitiesAgreeTids}
          ptptCount={this.state.ptptCount}
          error={this.state.probabilitiesAgreeError}/>*/}
        {/*<Matrix
          title={"Covariance matrix"}
          probabilities={covariance.matrix}
          tids={covariance.comments}
          ptptCount={this.state.ptptCount}
          />*/}
        <Matrix
          title={"Correlation matrix"}
          probabilities={this.state.filteredCorrelationMatrix}
          tids={this.state.filterecCorrelationTids}
          ptptCount={this.state.ptptCount}
          />
        <ParticipantGroups
          comments={this.state.comments}
          conversation={this.state.conversation}
          demographics={this.state.demographics}
          comments={this.state.comments}
          ptptCount={this.state.ptptCount}
          math={this.state.math}/>
        <Graph
          math={this.state.math}/>
        <p> ==================================== End Analysis ==================================== </p>
        <AllComments
          conversation={this.state.conversation}
          ptptCount={this.state.ptptCount}
          comments={this.state.comments}/>
      </div>
    );
  }
}

export default App;

window.$ = $;
