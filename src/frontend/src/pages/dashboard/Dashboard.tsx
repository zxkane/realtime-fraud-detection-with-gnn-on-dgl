// import TimelapseIcon from '@material-ui/icons/Timelapse';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
// import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
// import InputLabel from '@material-ui/core/InputLabel';
import FormControl from '@material-ui/core/FormControl';
import MenuItem from '@material-ui/core/MenuItem';
// import FormControlLabel from '@material-ui/core/FormControlLabel';
import Select from '@material-ui/core/Select';
// import Switch from '@material-ui/core/Switch';
import TextField from '@material-ui/core/TextField';
import WbIncandescentIcon from '@material-ui/icons/WbIncandescent';

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import { createQueue } from 'best-queue';
import Loader from 'react-loader-spinner';
import gql from 'graphql-tag';

import {
  momentFormatData,
  numberFormatter,
  DURATION_TIME_LIST,
  POLLING_INTERVAL_LIST,
  SYS_GATEWAY_API_URL,
  DEFAULT_PULLING_INTERVAL,
  DEFAULT_DURATION_TIME,
  TIME_TYPE,
} from '../../assets/js/const';
import { getTransactionStats, getFraudTransactions } from '../../graphql/queries';
import useWindowSize from '../../hooks/useWindowSize';

import CountCard from './comps/CountCard';
import RealtimeChart from './comps/RealtimeChart';
import TransactionList from './comps/TransactionList';

import ClientContext from '../../common/ClientContext';

interface FraudType {
  id: number;
  amount: number;
  isFraud: boolean;
  timestamp: number;
  isNew?: boolean;
}

const CHART_INIT_COUNT = 10;
// const TIME_INTEVAL = 20 * 1000;

const Dashboard: React.FC = () => {
  const client: any = React.useContext(ClientContext);
  const [transList, setTransList] = useState<FraudType[]>([]);
  const [dataHeight, setDataHeight] = useState(300);
  // const [timeRange, setTimeRange] = useState(5);
  const [fraudCount, setFraudCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [fraudAmount, setFraudAmount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [fraudCountArr, setFraudCountArr] = useState<number[]>([]);
  const [totalCountArr, setTotalCountArr] = useState<number[]>([]);
  const [dateTimeArr, setDateTimeArr] = useState<string[]>([]);
  // const [timeInterval, setTimeInterval] = useState(20 * 1000);
  const [hasNew, setHasNew] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  // const [disabledSimulate, setDisabledSimulate] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(DEFAULT_PULLING_INTERVAL);
  const [pollingChartInterval, setPollingChartInterval] = useState((DEFAULT_DURATION_TIME * 1000) / CHART_INIT_COUNT);
  const [dataDurationTime, setDataDurationTime] = useState(DEFAULT_DURATION_TIME);

  // Simulate Input Data
  const [loadingSimulate, setLoadingSimulate] = useState(false);
  const [duration, setDuration] = useState<string | number>(300); // Unit Seconds
  const [concurrent, setConcurrent] = useState<string | number>(10); // Unit Time (并发个数)
  const [dataInterval, setDataInterval] = useState<string | number>(3); // Unit Seconds, 传给后端需转换成 毫秒

  const size = useWindowSize();

  const simulateData = () => {
    if (duration < 300 || duration > 900) {
      Swal.fire('Duration is invalid');
      return;
    }
    if (concurrent < 1 || concurrent > 40) {
      Swal.fire('Concurrent is invalid');
      return;
    }
    if (dataInterval < 1 || dataInterval > 60) {
      Swal.fire('Interval is invalid');
      return;
    }
    const API_URL = localStorage.getItem(SYS_GATEWAY_API_URL);
    const data = {
      input: {
        duration: typeof duration === 'string' ? parseInt(duration) : duration,
        concurrent: typeof concurrent === 'string' ? parseInt(concurrent) : concurrent,
        interval: parseInt(dataInterval as string) * 1000,
      },
    };
    setLoadingSimulate(true);
    axios
      .post(`${API_URL}/start`, data)
      .then((res) => {
        console.info('res:', res);
        setLoadingSimulate(false);
        setOpenDialog(false);
        Swal.fire('Success', 'Please wait 1 minute to show data', 'success');
      })
      .catch((err) => {
        setLoadingSimulate(false);
        console.error(err);
      });
  };

  const getTransStatData = async (start: number, end: number) => {
    const query = gql(getTransactionStats);
    const statData: any = await client?.query({
      query: query,
      variables: {
        start: Math.floor(start),
        end: Math.round(end),
      },
    });
    const tmpData = statData.data.getTransactionStats;
    tmpData.start = start;
    tmpData.end = end;
    return tmpData;
  };

  const buildQueueList = () => {
    const now = new Date();
    const endTime = now.getTime() / 1000;
    // console.info('endTime:', endTime);
    const avgTime = dataDurationTime / CHART_INIT_COUNT;
    // console.info('avgTime:', avgTime);
    const asyncTasks = [];
    for (let i = 1; i <= CHART_INIT_COUNT; i++) {
      asyncTasks.push(getTransStatData(endTime - avgTime * i, endTime - avgTime * (i - 1)));
    }
    const queue = createQueue(asyncTasks, {
      max: 20,
      interval: 1 * 1000,
      recordError: false,
    });
    // console.info('queue:', queue);
    queue.resume();
    queue.then((result) => {
      let formatStr = TIME_TYPE.SECOND;
      if (avgTime >= 60) {
        formatStr = TIME_TYPE.MINUTE;
      }
      result.sort((a: any, b: any) => (a.start > b.start ? 1 : -1));
      const tmpFraudCountArr: any = [];
      const tmpTotalCountArr: any = [];
      const tmpDataTimeArr: any = [];
      result.forEach((element) => {
        tmpFraudCountArr.push(element.fraudCount);
        tmpTotalCountArr.push(element.totalCount);
        tmpDataTimeArr.push(momentFormatData(new Date(element.end * 1000), formatStr));
      });
      setFraudCountArr(tmpFraudCountArr);
      setTotalCountArr(tmpTotalCountArr);
      setDateTimeArr(tmpDataTimeArr);
    });
  };

  // Get Chart Data By Interval: durationTime/10
  // const getChartNextData = async () => {

  // };
  const getChartNextData = useCallback(async () => {
    const now = new Date();
    // now.setTime(now.getSeconds - )
    const prevChartTime = momentFormatData(new Date(), TIME_TYPE.WITH_YEAR, -pollingChartInterval / 1000);
    const startChartTime = new Date(prevChartTime.replace(/-/g, '/')).getTime();
    const endTime = now.getTime();
    console.info('start:end:', prevChartTime, endTime);
    const queryChart = gql(getTransactionStats);
    const chartData: any = await client?.query({
      query: queryChart,
      variables: {
        start: Math.floor(startChartTime / 1000),
        end: Math.round(endTime / 1000),
      },
    });
    setFraudCountArr((prev) => {
      return [...prev, chartData.data.getTransactionStats.fraudCount];
    });
    setTotalCountArr((prev) => {
      return [...prev, chartData.data.getTransactionStats.totalCount];
    });
    setDateTimeArr((prev) => {
      let formatStr = TIME_TYPE.SECOND;
      console.info('pollingChartInterval:', pollingChartInterval);
      if (pollingChartInterval >= 60 * 1000) {
        formatStr = TIME_TYPE.MINUTE;
      }
      return [...prev, momentFormatData(new Date(endTime), formatStr)];
    });
  }, [pollingChartInterval, client]);

  const getDashboardData = useCallback(async () => {
    const now = new Date();
    // now.setTime(now.getSeconds - )
    console.info('dataDurationTime:dataDurationTime:dataDurationTime:', dataDurationTime);
    const prevTime = momentFormatData(new Date(), TIME_TYPE.WITH_YEAR, -dataDurationTime);
    // const prevChartTime = momentFormatData(new Date(), true, -pollingInterval / 1000);
    const startTime = new Date(prevTime.replace(/-/g, '/')).getTime();
    // const startChartTime = new Date(prevChartTime).getTime();
    const endTime = now.getTime();
    console.info('getTransStats: timeTIME:', startTime, endTime);
    const query = gql(getTransactionStats);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statData: any = await client?.query({
      query: query,
      variables: {
        start: Math.floor(startTime / 1000),
        end: Math.round(endTime / 1000),
      },
    });

    if (statData && statData.data && statData.data.getTransactionStats) {
      setFraudCount(statData.data.getTransactionStats.fraudCount);
      setTotalCount(statData.data.getTransactionStats.totalCount);
      setFraudAmount(statData.data.getTransactionStats.totalFraudAmount);
      setTotalAmount(statData.data.getTransactionStats.totalAmount);
    }

    const queryList = gql(getFraudTransactions);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fraudList: any = await client?.query({
      query: queryList,
      variables: {
        start: Math.floor(startTime / 1000),
        end: Math.round(endTime / 1000),
      },
    });
    // const fraudList: any = await API.graphql({
    //   query: getFraudTransactions,
    //   variables: {
    //     start: Math.round(startTime / 1000),
    //     end: Math.round(endTime / 1000),
    //   },
    // });
    if (fraudList && fraudList.data && fraudList.data.getFraudTransactions) {
      const tmpTransList = fraudList.data.getFraudTransactions;
      setTransList((prev: FraudType[]) => {
        if (prev && prev.length > 0) {
          const idArr = prev.map((a) => a.id);
          const tmpArr: FraudType[] = [];
          tmpTransList.forEach((ele: FraudType) => {
            if (idArr.indexOf(ele.id) < 0) {
              ele.isNew = true;
              tmpArr.push(ele);
            }
          });
          setHasNew(true);
          return [...tmpArr, ...prev];
        } else {
          return [...tmpTransList, ...prev];
        }
      });
    }
  }, [dataDurationTime, client]);

  // Resize window
  useEffect(() => {
    setDataHeight(size.height - size.height * 0.42 - 40);
  }, [size]);

  // Interval to polling Dashboard data
  useEffect(() => {
    const id = setInterval(() => {
      getDashboardData();
    }, pollingInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingInterval, dataDurationTime]);

  // Interval to Polling Chart Data
  useEffect(() => {
    const chartIntervalId = setInterval(() => {
      console.info('GET CHART DATA');
      getChartNextData();
    }, pollingChartInterval);
    return () => clearInterval(chartIntervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingChartInterval]);

  // Change Duration
  const handleChangeDuration = (event: any) => {
    setDataDurationTime(event.target.value);
  };

  // Change Polling Time Interval
  const handleChangeTimeInterval = (event: any) => {
    setPollingInterval(event.target.value);
  };

  // Show New Fraud Transcation
  useEffect(() => {
    if (hasNew) {
      setTimeout(() => {
        setHasNew(false);
        setTransList((prevList) => {
          const tmpData = [...prevList];
          tmpData.forEach((element) => {
            element.isNew = false;
          });
          return tmpData;
        });
      }, 5000);
    }
  }, [transList, hasNew]);

  // Get Dashboard Date when duration changed
  useEffect(() => {
    getDashboardData();
    buildQueueList();
    setPollingChartInterval((dataDurationTime / CHART_INIT_COUNT) * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataDurationTime]);

  const handleClickOpen = () => {
    setOpenDialog(true);
  };

  const handleClose = () => {
    setOpenDialog(false);
  };

  return (
    <div>
      <div className="fds-dashboard-search">
        <div className="select">
          <b>Transcation in: </b>
          <Select
            style={{ marginRight: 15 }}
            id="transcation-in-select"
            labelId="transcation-in-label"
            variant="outlined"
            value={dataDurationTime}
            onChange={handleChangeDuration}
          >
            {DURATION_TIME_LIST.map((element, index) => {
              return (
                <MenuItem key={index} value={element.value}>
                  {element.name}
                </MenuItem>
              );
            })}
          </Select>

          <b>Polling Interval: </b>
          <Select
            variant="outlined"
            labelId="polling-interval"
            id="polling-interval-select"
            value={pollingInterval}
            onChange={handleChangeTimeInterval}
          >
            {POLLING_INTERVAL_LIST.map((element, index) => {
              return (
                <MenuItem key={index} value={element.value}>
                  {element.name}
                </MenuItem>
              );
            })}
          </Select>
        </div>
        <div className="search">
          {/* <TextField
            placeholder="Search by Transcation ID, User, Card Type"
            size="small"
            variant="outlined"
            color="primary"
            style={{ width: 400 }}
            type="text"
          />
          <Button style={{ marginLeft: 10 }} size="small" variant="contained" color="primary">
            Search
          </Button> */}
          <Button
            // disabled={disabledSimulate}
            onClick={() => {
              handleClickOpen();
            }}
            style={{ marginLeft: 10 }}
            variant="outlined"
            size="small"
            color="primary"
          >
            Simulate Data
          </Button>
        </div>
      </div>
      <div className="fds-dashboard-summury">
        <CountCard title={`Fraud Count`} value={fraudCount} bgColor="#da5b47" />
        <CountCard title={`Transcation Count`} value={totalCount} bgColor="#5494db" />
        <CountCard title={`Fraud Amount`} value={`$${numberFormatter(fraudAmount, 2)}`} bgColor="#f5bf4c" />
        <CountCard title={`Transcation Amount`} value={`$${numberFormatter(totalAmount, 2)}`} bgColor="#67c47d" />
      </div>
      <div>
        <div className="black-item-title">
          <WbIncandescentIcon className="icon" />
          Recent Fraud Transactions
        </div>
        <div className="fds-data-table" style={{ height: dataHeight }}>
          <div className="fds-linechart">
            <RealtimeChart
              height={dataHeight - 10}
              totalData={totalCountArr}
              series={fraudCountArr}
              categories={dateTimeArr}
            />
          </div>
          <div className="fds-data-list">
            <TransactionList transList={transList} />
          </div>
        </div>
      </div>
      <Dialog
        open={openDialog}
        onClose={handleClose}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">{'Simulate Transcation Data'}</DialogTitle>
        <DialogContent style={{ width: 500 }}>
          <FormControl fullWidth variant="outlined">
            <div className="form-title">
              Simulation data duration time: <span>(Unit: Second, Min: 300, Max: 900)</span>
            </div>
            <TextField
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setDuration(event.target.value);
              }}
              type="number"
              InputProps={{ inputProps: { min: 300, max: 900 } }}
              value={duration}
              placeholder="Max: 900 seconds"
              size="small"
              variant="outlined"
              id="Duration"
            />
          </FormControl>
          <FormControl fullWidth variant="outlined" style={{ marginTop: 10 }}>
            <div className="form-title">
              Transcation concurrent count:<span>(Min: 1, Max: 40)</span>
            </div>
            <TextField
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setConcurrent(event.target.value);
              }}
              type="number"
              InputProps={{ inputProps: { min: 1, max: 40 } }}
              value={concurrent}
              placeholder="Max: 40"
              size="small"
              variant="outlined"
              id="Concurrent"
            />
          </FormControl>
          <FormControl fullWidth variant="outlined" style={{ marginTop: 10 }}>
            <div className="form-title">
              Simulation Interval:<span>(Unit: Second, Min: 1, Max: 60)</span>
            </div>
            <TextField
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setDataInterval(event.target.value);
              }}
              type="number"
              InputProps={{ inputProps: { min: 1, max: 60 } }}
              value={dataInterval}
              placeholder="Min: 1, Max: 60"
              size="small"
              variant="outlined"
              id="Interval"
            />
          </FormControl>
        </DialogContent>
        <DialogActions className="padding20">
          <Button variant="outlined" onClick={handleClose} color="primary">
            Cancel
          </Button>
          {loadingSimulate ? (
            <Button variant="contained" disabled={true}>
              <Loader type="ThreeDots" color="#888" height={10} />
            </Button>
          ) : (
            <Button variant="contained" onClick={simulateData} color="primary" autoFocus>
              Simulate
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default Dashboard;
