import NotificationsIcon from '@material-ui/icons/Notifications';
import Amplify from 'aws-amplify';
import AWS from 'aws-sdk';
import axios from 'axios';
import { AWSAppSyncClient, AUTH_TYPE } from 'aws-appsync';
import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter, Route, Switch } from 'react-router-dom';
// import Swal from 'sweetalert2';

import logo from './assets/images/logo.svg';

import DataLoading from './common/Loading';

import Dashboard from './pages/dashboard/Dashboard';
import NotFound from './pages/error/NotFound';
import SearchList from './pages/list/SearchList';

import { SYS_GATEWAY_API_URL } from './assets/js/const';
import ClientContext from './common/ClientContext';

// Amplify.configure(awsconfig);
// loading component for suspense fallback
const Loader = () => (
  <div className="App">
    <div className="app-loading">
      <DataLoading />
      Real-time Fraud Detection Demo is loading...
    </div>
  </div>
);

const App: React.FC = () => {
  const [appLoading, setAppLoading] = useState(true);

  const [client, setClient] = useState<any>(null);
  const [tokenInvalidTime, setTokenInvalidTime] = useState(0);
  const [curConfigData, setcurConfigData] = useState(null);

  const buildAppSyncClient = useCallback((configData: any) => {
    axios.get(configData.api_path + '/token').then((tokenData) => {
      // const tokenDate = new Date();
      const expireDate = tokenData.data.Expiration;
      const tokenDate = new Date(expireDate.replace(/-/g, '/'));
      tokenDate.setSeconds(tokenDate.getSeconds() + 10);
      setTokenInvalidTime(new Date(tokenDate).getTime());
      // Build AppSync Client
      setClient(
        new AWSAppSyncClient({
          disableOffline: true,
          url: configData.aws_appsync_graphqlEndpoint,
          region: configData.aws_appsync_region,
          auth: {
            type: AUTH_TYPE.AWS_IAM,
            credentials: new AWS.Credentials({
              accessKeyId: tokenData.data.AccessKeyId,
              secretAccessKey: tokenData.data.SecretAccessKey,
              sessionToken: tokenData.data.SessionToken,
            }),
          },
        }),
      );
      setAppLoading(false);
    });
  }, []);

  useEffect(() => {
    if (curConfigData !== null) {
      buildAppSyncClient(curConfigData);
    }
  }, [curConfigData, buildAppSyncClient]);

  useEffect(() => {
    const timeStamp = new Date().getTime();
    axios
      .get('/aws-exports.json?timeStamp=' + timeStamp)
      .then((res) => {
        const ConfigObj = res.data;
        // Set API_GATEWAY_URL to localstorage
        localStorage.setItem(SYS_GATEWAY_API_URL, ConfigObj.api_path);
        // Amplify Configure
        Amplify.configure(res.data);
        console.info(res);
        return ConfigObj;
      })
      .then((configData) => {
        setcurConfigData(configData);
      })
      .catch((err) => {
        setAppLoading(false);
        console.error(err);
      });
    return () => {
      console.info('clean');
    };
  }, [buildAppSyncClient]);

  // Check Token Expire
  useEffect(() => {
    const interval = setInterval(() => {
      if (tokenInvalidTime) {
        console.info('tokenInvalidTime:', tokenInvalidTime);
        console.info('new Date().getTime():', new Date().getTime());
        if (tokenInvalidTime < new Date().getTime()) {
          clearInterval(interval);
          buildAppSyncClient(curConfigData);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [tokenInvalidTime, buildAppSyncClient, curConfigData]);

  if (appLoading) {
    return <Loader />;
  }

  return (
    <ClientContext.Provider value={client}>
      <div className="App">
        <div className="container">
          <div className="fs-header">
            <div className="logo">
              <img className="img" width="30" alt="solutions" src={logo} />
              Real-time Fraud Detection with Graph Neural Network on DGL(Demo)
            </div>
            <div className="user text-right">
              <div style={{ fontSize: '14px', marginTop: 7 }}>
                <NotificationsIcon />
              </div>
              {/* <div>Admin User</div> */}
            </div>
          </div>
          <div className="fs-body">
            <HashRouter>
              <Switch>
                <Route exact path="/" component={Dashboard} />
                <Route exact path="/list" component={SearchList} />
                <Route component={NotFound} />
              </Switch>
            </HashRouter>
          </div>
          {/* <div className="fs-footer">
          © 2008 - 2021, Amazon Web Services, Inc. or its affiliates. All rights reserved.
        </div> */}
        </div>
      </div>
    </ClientContext.Provider>
  );
};

const DetectionApp: React.FC = () => {
  return <App />;
};

export default DetectionApp;
